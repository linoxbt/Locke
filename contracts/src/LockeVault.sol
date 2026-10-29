// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVerantaRouter, IVerantaTradingStorage} from "./interfaces/IVeranta.sol";

/**
 * @title LockeVault
 * @notice One business's protection vault on Base. It holds the business's USDC and is the
 * trader on Veranta, so every payout lands back here. Three roles:
 *  - owner: deposits, withdraws idle USDC at any time, closes any hedge, sets the plan limits
 *    and replaces or removes the keeper;
 *  - keeper (Locke's server): opens, closes and tops up hedges, only within the plan limits,
 *    and can never send USDC anywhere but Veranta;
 *  - guardian (Locke's multisig): pauses new deposits and new hedges, never exits.
 * Deployed as a clone by LockeVaultFactory; not upgradeable.
 */
contract LockeVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant MARKET = 0;
    uint8 private constant DEPOSIT = 0;
    uint256 private constant PRECISION = 1e10;

    /// @notice What the keeper may do on one Veranta pair.
    struct Plan {
        bool enabled;
        bool buy; // hedge side: true = long (costs plans), false = short (holdings plans)
        uint64 maxLeverage; // 1e10
        uint128 maxNotional; // collateral x leverage, USDC 1e6
    }

    address public owner;
    address public keeper;
    address public guardian;
    bool public paused;

    IERC20 public usdc;
    IVerantaRouter public router;
    IVerantaTradingStorage public tradingStorage;

    mapping(uint256 pairIndex => Plan) public plans;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PlanSet(uint256 indexed pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional);
    event KeeperSet(address indexed keeper);
    event OwnerSet(address indexed owner);
    event Paused(bool paused);
    event HedgeOpenRequested(uint256 indexed pairIndex, uint256 orderId, bool buy, uint256 collateral, uint256 leverage);
    event HedgeCloseRequested(uint256 indexed pairIndex, uint256 indexed index, uint256 orderId, uint256 collateral, address by);
    event MarginUpdated(uint256 indexed pairIndex, uint256 indexed index, uint8 updateType, uint256 amount, address by);

    error NotOwner();
    error NotKeeper();
    error NotGuardian();
    error IsPaused();
    error PlanDisabled();
    error WrongSide();
    error LeverageTooHigh();
    error NotionalTooHigh();
    error PositionExists();
    error ZeroAddress();
    error ZeroAmount();

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

    function initialize(
        address owner_,
        address keeper_,
        address guardian_,
        IERC20 usdc_,
        IVerantaRouter router_,
        IVerantaTradingStorage tradingStorage_
    ) external initializer {
        if (owner_ == address(0) || guardian_ == address(0) || address(usdc_) == address(0)) revert ZeroAddress();
        if (address(router_) == address(0) || address(tradingStorage_) == address(0)) revert ZeroAddress();
        owner = owner_;
        keeper = keeper_;
        guardian = guardian_;
        usdc = usdc_;
        router = router_;
        tradingStorage = tradingStorage_;
        // Veranta pulls collateral from the trader through TradingStorage.
        usdc_.forceApprove(address(tradingStorage_), type(uint256).max);
        emit OwnerSet(owner_);
        emit KeeperSet(keeper_);
    }

    // ------------------------------------------------------------------ owner

    /// @notice Add USDC from the caller. Anyone may top the vault up; only the owner takes it out.
    function deposit(uint256 amount) external nonReentrant {
        if (paused) revert IsPaused();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Take out idle USDC. Works while paused and whatever the keeper is doing.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function setPlan(uint256 pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional)
        external
        onlyOwner
    {
        plans[pairIndex] = Plan(enabled, buy, maxLeverage, maxNotional);
        emit PlanSet(pairIndex, enabled, buy, maxLeverage, maxNotional);
    }

    /// @notice Replace the keeper, or pass address(0) to remove it. The owner keeps every exit.
    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function transferOwnership(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerSet(owner_);
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

    /// @notice Return ETH left over from oracle fees.
    function sweepEth(address payable to) external onlyOwner nonReentrant {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok);
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
        if (paused) revert IsPaused();
        Plan memory plan = plans[pairIndex];
        if (!plan.enabled) revert PlanDisabled();
        if (leverage > plan.maxLeverage) revert LeverageTooHigh();
        if ((collateral * leverage) / PRECISION > plan.maxNotional) revert NotionalTooHigh();
        if (
            tradingStorage.openTradesCount(address(this), pairIndex) != 0
                || tradingStorage.pendingMarketOpenCount(address(this), pairIndex) != 0
        ) revert PositionExists();

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

    /// @notice Add margin to a hedge to keep it away from liquidation. Allowed while paused.
    function topUpMargin(
        uint256 pairIndex,
        uint256 index,
        uint256 amount,
        bytes[] calldata priceUpdateData,
        uint8 priceSourcing
    ) external payable onlyKeeper nonReentrant returns (uint256 orderId) {
        if (amount == 0) revert ZeroAmount();
        orderId = router.updateMargin{value: msg.value}(pairIndex, index, DEPOSIT, amount, priceUpdateData, priceSourcing);
        emit MarginUpdated(pairIndex, index, DEPOSIT, amount, msg.sender);
    }

    // ------------------------------------------------------------------ guardian

    /// @notice Stop new deposits and new hedges. Withdrawals, closes and top-ups keep working.
    function setPaused(bool paused_) external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = paused_;
        emit Paused(paused_);
    }

    receive() external payable {}
}
