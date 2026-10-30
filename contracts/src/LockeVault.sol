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
}

/**
 * @title LockeVault
 * @notice One business's protection vault on Base. It holds the business's USDC and is the
 * trader on Veranta, so every payout lands back here. Three roles:
 *  - owner: deposits, withdraws idle USDC at any time, closes any hedge, moves margin, sets the
 *    plan limits and replaces or removes the keeper;
 *  - keeper (Locke's server): opens, closes and tops up hedges, only within the plan limits and
 *    at most one open per market per hour, and can never send USDC anywhere but Veranta and,
 *    when the vault was created with a fee, Locke's fee on each open;
 *  - guardian (Locke's multisig, set on the factory): pauses new deposits and new hedges, never
 *    exits.
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

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
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
        // Veranta pulls collateral from the trader through TradingStorage.
        usdc_.forceApprove(address(tradingStorage_), type(uint256).max);
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
        orderId = router.updateMargin{value: msg.value}(pairIndex, index, updateType, amount, priceUpdateData, priceSourcing);
        emit MarginUpdated(pairIndex, index, updateType, amount, msg.sender);
    }

    /// @notice Recover any other token sent here by mistake. USDC leaves only through `withdraw`.
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (address(token) == address(usdc)) revert UseWithdraw();
        token.safeTransfer(to, amount);
    }

    /// @notice Return ETH left over from oracle fees.
    function sweepEth(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
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
        if (leverage > plan.maxLeverage) revert LeverageTooHigh();
        uint256 notional = (collateral * leverage) / PRECISION;
        if (notional > plan.maxNotional) revert NotionalTooHigh();
        if (block.timestamp < lastOpenAt[pairIndex] + OPEN_COOLDOWN) revert TooSoon();
        if (
            tradingStorage.openTradesCount(address(this), pairIndex) != 0
                || tradingStorage.pendingMarketOpenCount(address(this), pairIndex) != 0
        ) revert PositionExists();
        lastOpenAt[pairIndex] = block.timestamp;

        uint256 fee = (collateral * leverage * feeBps) / (PRECISION * BPS);
        if (fee != 0) {
            address collector = factory.feeCollector();
            if (collector != address(0)) {
                usdc.safeTransfer(collector, fee);
                emit FeePaid(pairIndex, collector, fee);
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
        orderId = router.openTrade{value: msg.value}(t, MARKET, slippageP);
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
        orderId = router.updateMargin{value: msg.value}(pairIndex, index, DEPOSIT, amount, priceUpdateData, priceSourcing);
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

    function _setPlan(uint256 pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional) private {
        if (enabled && (maxLeverage < PRECISION || maxNotional == 0)) revert BadPlan();
        plans[pairIndex] = Plan(enabled, buy, maxLeverage, maxNotional);
        emit PlanSet(pairIndex, enabled, buy, maxLeverage, maxNotional);
    }
}
