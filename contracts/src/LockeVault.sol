// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVerantaRouter, IVerantaTradingStorage} from "./interfaces/IVeranta.sol";
import {ISpendPermissionManager} from "./interfaces/ISpendPermissionManager.sol";

/// @notice What a vault reads from its factory: who may pause, where fees go, and the deposit caps.
interface ILockeFactory {
    function guardian() external view returns (address);
    function paused() external view returns (bool);
    function feeCollector() external view returns (address);
    function recordDeposit(uint256 amount, uint256 vaultNetDeposits) external;
    function recordWithdraw(uint256 amount) external;
    function keeperRevoked(address keeper) external view returns (bool);
}

/**
 * @title LockeVault
 * @notice One business's protection vault on Base. It holds the business's USDC and is the
 * trader on Veranta, so every payout lands back here. Three roles:
 *  - owner: deposits, withdraws idle USDC at any time, closes any hedge, moves margin, sets the
 *    plan limits and replaces or removes the keeper;
 *  - keeper (Locke's server): opens, closes and tops up hedges, only within the plan limits and
 *    at most one open per market per hour, with bounded slippage, and can never send USDC anywhere
 *    but Veranta and, when the vault was created with a fee, Locke's fee: owed when an open is
 *    placed, paid only once the trade exists, at most once per market per 30 days;
 *  - guardian (Locke's multisig, set on the factory): pauses new deposits and new hedges, and
 *    revokes a compromised keeper key for every vault at once; never touches exits.
 * Veranta pulls exactly the USDC each order needs: the vault approves that amount for the call
 * and resets the approval to zero, so no standing allowance exposes its idle balance.
 * "Protect as you get paid": the owner's Base Account may sign a spend permission naming this
 * vault as spender; the keeper then moves part of the owner's incoming USDC into the vault, never
 * more per period than the owner allowed, and only ever from the owner to this vault.
 * Deployed as a clone by LockeVaultFactory; not upgradeable.
 */
contract LockeVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant MARKET = 0;
    uint8 private constant DEPOSIT = 0;
    uint256 private constant PRECISION = 1e10;
    uint256 private constant BPS = 10_000;
    /// @notice Hard ceiling on Locke's fee: 0.20% of the notional of each hedge the keeper opens.
    uint16 public constant MAX_FEE_BPS = 20;
    /// @notice A keeper may open a market at most once per hour, so a stolen keeper key cannot churn fees.
    uint256 public constant OPEN_COOLDOWN = 1 hours;
    /// @notice Most slippage an open may allow: 3% (Veranta's 1e10 = 1%).
    uint256 public constant MAX_SLIPPAGE_P = 3e10;
    /// @notice Locke's fee is charged at most once per market in this period, however often a hedge is reopened.
    uint256 public constant FEE_PERIOD = 30 days;
    /// @notice Base Account's SpendPermissionManager (the same address on Base and Base Sepolia).
    ISpendPermissionManager public constant SPEND_PERMISSIONS = ISpendPermissionManager(0xf85210B21cC50302F477BA56686d2019dC9b67Ad);

    /// @notice What the keeper may do on one Veranta pair.
    struct Plan {
        bool enabled;
        bool buy; // hedge side: true = long (costs plans), false = short (holdings plans)
        uint64 maxLeverage; // 1e10
        uint128 maxNotional; // collateral x leverage, USDC 1e6; also caps the collateral in one position
    }

    ILockeFactory public factory;
    IERC20 public usdc;
    IVerantaRouter public router;
    IVerantaTradingStorage public tradingStorage;

    address public owner;
    address public pendingOwner;
    address public keeper;
    bool public pausedByGuardian;
    /// @notice Locke's fee in basis points of notional, fixed when the vault was created.
    uint16 public feeBps;
    /// @notice Deposits less withdrawals (never below zero); what the launch caps count.
    uint256 public netDeposits;

    mapping(uint256 pairIndex => Plan) public plans;
    mapping(uint256 pairIndex => uint256) public lastOpenAt;
    /// @notice Fee owed for an open that was placed and not yet seen as a trade.
    mapping(uint256 pairIndex => uint256) public feeOwed;
    /// @notice When Locke's fee was last paid for this market.
    mapping(uint256 pairIndex => uint256) public lastFeeAt;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PlanSet(uint256 indexed pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional);
    event KeeperSet(address indexed keeper);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnerSet(address indexed owner);
    event Paused(bool paused);
    event FeePaid(uint256 indexed pairIndex, address indexed collector, uint256 amount);
    event HedgeOpenRequested(uint256 indexed pairIndex, uint256 orderId, bool buy, uint256 collateral, uint256 leverage);
    event HedgeCloseRequested(uint256 indexed pairIndex, uint256 indexed index, uint256 orderId, uint256 collateral, address by);
    event MarginUpdated(uint256 indexed pairIndex, uint256 indexed index, uint8 updateType, uint256 amount, address by);
    event IncomeCollected(address indexed from, uint256 amount);
    event FeeAccrued(uint256 indexed pairIndex, uint256 amount);
    event FeeCancelled(uint256 indexed pairIndex, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event EthSwept(address indexed to, uint256 amount);
    event OwnershipTransferCancelled(address indexed pendingOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotKeeper();
    error NotGuardian();
    error IsPaused();
    error PlanDisabled();
    error BadPlan();
    error LeverageTooHigh();
    error NotionalTooHigh();
    error CollateralTooHigh();
    error PositionExists();
    error TooSoon();
    error FeeTooHigh();
    error ZeroAddress();
    error ZeroAmount();
    error UseWithdraw();
    error BadPermission();
    error ShortReceipt();
    error SlippageOutOfRange();
    error LeverageTooLow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev The vault's keeper, unless Locke's guardian revoked that key for every vault.
    modifier onlyKeeper() {
        if (msg.sender != keeper || factory.keeperRevoked(msg.sender)) revert NotKeeper();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /// @dev Called once by the factory, in the same transaction that deploys the clone.
    function initialize(
        address owner_,
        address keeper_,
        uint16 feeBps_,
        uint256 pairIndex,
        Plan calldata plan,
        IERC20 usdc_,
        IVerantaRouter router_,
        IVerantaTradingStorage tradingStorage_
    ) external initializer {
        if (owner_ == address(0) || address(usdc_) == address(0)) revert ZeroAddress();
        if (address(router_) == address(0) || address(tradingStorage_) == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        factory = ILockeFactory(msg.sender);
        usdc = usdc_;
        router = router_;
        tradingStorage = tradingStorage_;
        owner = owner_;
        keeper = keeper_;
        feeBps = feeBps_;
        _setPlan(pairIndex, plan.enabled, plan.buy, plan.maxLeverage, plan.maxNotional);
        emit OwnerSet(owner_);
        emit KeeperSet(keeper_);
    }

    /// @notice True while new deposits and new hedges are stopped, by this vault's guardian or for all vaults.
    function paused() public view returns (bool) {
        return pausedByGuardian || factory.paused();
    }

    function guardian() public view returns (address) {
        return factory.guardian();
    }

    // ------------------------------------------------------------------ owner

    /// @notice Add USDC from the caller. Anyone may top the vault up; only the owner takes it out.
    function deposit(uint256 amount) external nonReentrant {
        if (paused()) revert IsPaused();
        if (amount == 0) revert ZeroAmount();
        netDeposits += amount;
        factory.recordDeposit(amount, netDeposits); // reverts above the launch caps
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Take out idle USDC. Works while paused and whatever the keeper is doing.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 counted = amount < netDeposits ? amount : netDeposits;
        if (counted != 0) {
            netDeposits -= counted;
            factory.recordWithdraw(counted);
        }
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function setPlan(uint256 pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional) external onlyOwner {
        _setPlan(pairIndex, enabled, buy, maxLeverage, maxNotional);
    }

    /// @notice Replace the keeper, or pass address(0) to remove it (deliberately allowed). The owner keeps every exit.
    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Start handing the vault to a new owner; it takes effect when they accept.
    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    /// @notice Withdraw a handover that hasn't been accepted.
    function cancelOwnershipTransfer() external onlyOwner {
        emit OwnershipTransferCancelled(pendingOwner);
        pendingOwner = address(0);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerSet(msg.sender);
    }

    /// @notice Close all or part of a hedge directly on Veranta, without Locke.
    function ownerClose(uint256 pairIndex, uint256 index, uint256 collateral, uint256 wantedPrice)
        external
        payable
        onlyOwner
        nonReentrant
        returns (uint256 orderId)
    {
        _settleFee(pairIndex);
        orderId = router.closeTradeMarket{value: msg.value}(pairIndex, index, collateral, wantedPrice);
        emit HedgeCloseRequested(pairIndex, index, orderId, collateral, msg.sender);
    }

    /// @notice Add or remove margin on a hedge. Removed margin comes back to this vault.
    function ownerUpdateMargin(
        uint256 pairIndex,
        uint256 index,
        uint8 updateType,
        uint256 amount,
        bytes[] calldata priceUpdateData,
        uint8 priceSourcing
    ) external payable onlyOwner nonReentrant returns (uint256 orderId) {
        _settleFee(pairIndex);
        if (updateType == DEPOSIT) usdc.forceApprove(address(tradingStorage), amount);
        orderId = router.updateMargin{value: msg.value}(pairIndex, index, updateType, amount, priceUpdateData, priceSourcing);
        if (updateType == DEPOSIT) usdc.forceApprove(address(tradingStorage), 0);
        emit MarginUpdated(pairIndex, index, updateType, amount, msg.sender);
    }

    /// @notice Recover any other token sent here by mistake. USDC leaves only through `withdraw`.
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (address(token) == address(usdc)) revert UseWithdraw();
        token.safeTransfer(to, amount);
        emit TokenRescued(address(token), to, amount);
    }

    /// @notice Return ETH left over from oracle fees.
    function sweepEth(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        emit EthSwept(to, amount);
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    /**
     * @notice Settle Locke's fee for an open: paid once the trade exists, cancelled if the order
     * ended without one. Anyone may call it; the keeper does once the hedge opens.
     */
    function settleFee(uint256 pairIndex) external nonReentrant {
        _settleFee(pairIndex);
    }

    // ------------------------------------------------------------------ keeper

    /**
     * @notice Open the hedge for a pair, within the owner's plan. One position per pair: resizing
     * is a close plus a new open, so the notional cap always covers the whole hedge.
     */
    function hedgeOpen(uint256 pairIndex, uint256 collateral, uint256 leverage, uint256 wantedPrice, uint256 slippageP)
        external
        payable
        onlyKeeper
        nonReentrant
        returns (uint256 orderId)
    {
        if (paused()) revert IsPaused();
        Plan memory plan = plans[pairIndex];
        if (!plan.enabled) revert PlanDisabled();
        if (leverage < PRECISION) revert LeverageTooLow();
        if (leverage > plan.maxLeverage) revert LeverageTooHigh();
        // Slippage is the vault's only protection on the fill price: never off, never wide.
        if (slippageP == 0 || slippageP > MAX_SLIPPAGE_P) revert SlippageOutOfRange();
        uint256 notional = (collateral * leverage) / PRECISION;
        if (notional > plan.maxNotional) revert NotionalTooHigh();
        if (block.timestamp < lastOpenAt[pairIndex] + OPEN_COOLDOWN) revert TooSoon();
        if (
            tradingStorage.openTradesCount(address(this), pairIndex) != 0
                || tradingStorage.pendingMarketOpenCount(address(this), pairIndex) != 0
        ) revert PositionExists();
        // No trade and no pending order: any fee still owed is for an open that never filled.
        _cancelFee(pairIndex);
        lastOpenAt[pairIndex] = block.timestamp;

        // The fee is owed now and paid only once the trade exists (settleFee), at most once a period.
        if (feeBps != 0 && block.timestamp >= lastFeeAt[pairIndex] + FEE_PERIOD) {
            uint256 fee = (collateral * leverage * feeBps) / (PRECISION * BPS);
            if (fee != 0) {
                feeOwed[pairIndex] = fee;
                emit FeeAccrued(pairIndex, fee);
            }
        }

        IVerantaTradingStorage.Trade memory t = IVerantaTradingStorage.Trade({
            trader: address(this),
            pairIndex: pairIndex,
            index: 0,
            initialPosToken: 0,
            positionSizeUSDC: collateral,
            openPrice: wantedPrice,
            buy: plan.buy,
            leverage: leverage,
            tp: 0,
            sl: 0,
            timestamp: 0
        });
        usdc.forceApprove(address(tradingStorage), collateral);
        orderId = router.openTrade{value: msg.value}(t, MARKET, slippageP);
        usdc.forceApprove(address(tradingStorage), 0);
        emit HedgeOpenRequested(pairIndex, orderId, plan.buy, collateral, leverage);
    }

    /// @notice Close all or part of a hedge. Proceeds come back to this vault.
    function hedgeClose(uint256 pairIndex, uint256 index, uint256 collateral, uint256 wantedPrice)
        external
        payable
        onlyKeeper
        nonReentrant
        returns (uint256 orderId)
    {
        _settleFee(pairIndex);
        orderId = router.closeTradeMarket{value: msg.value}(pairIndex, index, collateral, wantedPrice);
        emit HedgeCloseRequested(pairIndex, index, orderId, collateral, msg.sender);
    }

    /**
     * @notice Add margin to a hedge to keep it away from liquidation. Allowed while paused. The
     * position's collateral may not pass the plan's notional cap, which bounds what the keeper
     * can move out of the vault's idle balance.
     */
    function topUpMargin(
        uint256 pairIndex,
        uint256 index,
        uint256 amount,
        bytes[] calldata priceUpdateData,
        uint8 priceSourcing
    ) external payable onlyKeeper nonReentrant returns (uint256 orderId) {
        if (amount == 0) revert ZeroAmount();
        uint256 collateral = tradingStorage.openTrades(address(this), pairIndex, index).initialPosToken;
        if (collateral + amount > plans[pairIndex].maxNotional) revert CollateralTooHigh();
        _settleFee(pairIndex);
        usdc.forceApprove(address(tradingStorage), amount);
        orderId = router.updateMargin{value: msg.value}(pairIndex, index, DEPOSIT, amount, priceUpdateData, priceSourcing);
        usdc.forceApprove(address(tradingStorage), 0);
        emit MarginUpdated(pairIndex, index, DEPOSIT, amount, msg.sender);
    }

    /**
     * @notice Keeper: move USDC the owner set aside for protection from the owner's Base Account
     * into this vault, under a spend permission the owner signed naming this vault as spender.
     * The manager enforces the allowance per period; the amount counts as a deposit (launch caps
     * apply). Pass the owner's signature until the permission is approved on chain, then empty.
     */
    function collectIncome(ISpendPermissionManager.SpendPermission calldata permission, bytes calldata signature, uint160 amount)
        external
        onlyKeeper
        nonReentrant
    {
        if (paused()) revert IsPaused();
        if (amount == 0) revert ZeroAmount();
        if (permission.account != owner || permission.spender != address(this) || permission.token != address(usdc)) revert BadPermission();
        netDeposits += amount;
        factory.recordDeposit(amount, netDeposits); // reverts above the launch caps
        if (signature.length != 0 && !SPEND_PERMISSIONS.isApproved(permission)) {
            if (!SPEND_PERMISSIONS.approveWithSignature(permission, signature)) revert BadPermission();
        }
        uint256 before = usdc.balanceOf(address(this));
        SPEND_PERMISSIONS.spend(permission, amount);
        if (usdc.balanceOf(address(this)) - before != amount) revert ShortReceipt();
        emit IncomeCollected(permission.account, amount);
    }

    // ------------------------------------------------------------------ guardian

    /// @notice Stop new deposits and new hedges. Withdrawals, closes and top-ups keep working.
    function setPaused(bool paused_) external {
        if (msg.sender != guardian()) revert NotGuardian();
        pausedByGuardian = paused_;
        emit Paused(paused_);
    }

    receive() external payable {}

    function _settleFee(uint256 pairIndex) private {
        uint256 owed = feeOwed[pairIndex];
        if (owed == 0) return;
        if (tradingStorage.openTradesCount(address(this), pairIndex) != 0) {
            _payFee(pairIndex, owed);
        } else if (tradingStorage.pendingMarketOpenCount(address(this), pairIndex) == 0) {
            _cancelFee(pairIndex);
        }
    }

    function _cancelFee(uint256 pairIndex) private {
        uint256 owed = feeOwed[pairIndex];
        if (owed == 0) return;
        feeOwed[pairIndex] = 0;
        emit FeeCancelled(pairIndex, owed);
    }

    /// @dev Never reverts: a fee transfer that fails (collector blocked, balance short) must not stop
    /// an owner's close or margin change. What can't be paid stays owed.
    function _payFee(uint256 pairIndex, uint256 owed) private {
        address collector = factory.feeCollector();
        if (collector == address(0)) return _cancelFee(pairIndex);
        uint256 balance = usdc.balanceOf(address(this));
        uint256 amount = owed < balance ? owed : balance;
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (collector, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) return;
        feeOwed[pairIndex] = owed - amount;
        lastFeeAt[pairIndex] = block.timestamp;
        emit FeePaid(pairIndex, collector, amount);
    }

    function _setPlan(uint256 pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional) private {
        if (enabled && (maxLeverage < PRECISION || maxNotional == 0)) revert BadPlan();
        plans[pairIndex] = Plan(enabled, buy, maxLeverage, maxNotional);
        emit PlanSet(pairIndex, enabled, buy, maxLeverage, maxNotional);
    }
}
