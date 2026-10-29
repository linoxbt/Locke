// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The slice of Veranta's (formerly Avantis) trading interface a Locke vault uses.
/// Mirrors the verified TradingRouter / TradingStorage sources on Base (chain 8453).
/// Units: prices, leverage and slippage 1e10; USDC 1e6.
interface IVerantaTradingStorage {
    struct Trade {
        address trader;
        uint256 pairIndex;
        uint256 index;
        uint256 initialPosToken; // collateral of an open trade (1e6)
        uint256 positionSizeUSDC; // collateral in an open request (1e6)
        uint256 openPrice;
        bool buy;
        uint256 leverage;
        uint256 tp;
        uint256 sl;
        uint256 timestamp;
    }

    struct TradeInfo {
        uint256 openInterestUSDC;
        uint256 tpLastUpdated;
        uint256 slLastUpdated;
        bool beingMarketClosed;
        uint256 lossProtection;
    }

    function openTrades(address trader, uint256 pairIndex, uint256 index) external view returns (Trade memory);
    function openTradesInfo(address trader, uint256 pairIndex, uint256 index) external view returns (TradeInfo memory);
    function openTradesCount(address trader, uint256 pairIndex) external view returns (uint256);
    function pendingMarketOpenCount(address trader, uint256 pairIndex) external view returns (uint256);
    function gov() external view returns (address);
}

interface IVerantaRouter {
    /// @dev OpenLimitOrderType: 0 MARKET. UpdateType: 0 DEPOSIT, 1 WITHDRAW.
    /// PriceSourcing: 0 PYTH_CORE, 1 PYTH_LAZER.
    function openTrade(IVerantaTradingStorage.Trade calldata trade, uint8 orderType, uint256 slippageP)
        external
        payable
        returns (uint256 orderId);

    function closeTradeMarket(uint256 pairIndex, uint256 index, uint256 collateral, uint256 wantedPrice)
        external
        payable
        returns (uint256 orderId);

    function updateMargin(
        uint256 pairIndex,
        uint256 index,
        uint8 updateType,
        uint256 amount,
        bytes[] calldata priceUpdateData,
        uint8 priceSourcing
    ) external payable returns (uint256 orderId);

    function storageT() external view returns (address);
}
