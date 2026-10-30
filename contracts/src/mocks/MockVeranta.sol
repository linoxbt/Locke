// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVerantaTradingStorage} from "../interfaces/IVeranta.sol";
import {ISpendPermissionManager} from "../interfaces/ISpendPermissionManager.sol";

/// @dev Test-only stand-ins for USDC and Veranta, for the offline unit tests.
contract MockUSDC is ERC20("USD Coin", "USDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Records what the vault asks for and moves collateral like Veranta (pull on open, pay on close).
contract MockVeranta {
    IERC20 public immutable usdc;
    mapping(address => mapping(uint256 => uint256)) public openCount;
    mapping(address => mapping(uint256 => uint256)) public collateralOf;
    uint256 public nextOrderId = 1;
    uint256 public lastMargin;
    uint256 public lastValue;

    constructor(IERC20 usdc_) {
        usdc = usdc_;
    }

    // TradingStorage views
    function openTradesCount(address trader, uint256 pairIndex) external view returns (uint256) {
        return openCount[trader][pairIndex];
    }

    function pendingMarketOpenCount(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function openTrades(address trader, uint256 pairIndex, uint256) external view returns (IVerantaTradingStorage.Trade memory t) {
        t.trader = trader;
        t.pairIndex = pairIndex;
        t.initialPosToken = collateralOf[trader][pairIndex];
        t.leverage = openCount[trader][pairIndex] == 0 ? 0 : 1e10;
    }

    // Router
    function openTrade(IVerantaTradingStorage.Trade calldata t, uint8, uint256) external payable returns (uint256) {
        usdc.transferFrom(msg.sender, address(this), t.positionSizeUSDC);
        openCount[msg.sender][t.pairIndex] += 1;
        collateralOf[msg.sender][t.pairIndex] += t.positionSizeUSDC;
        lastValue = msg.value;
        return nextOrderId++;
    }

    function closeTradeMarket(uint256 pairIndex, uint256, uint256 collateral, uint256) external payable returns (uint256) {
        collateralOf[msg.sender][pairIndex] -= collateral;
        if (collateralOf[msg.sender][pairIndex] == 0) openCount[msg.sender][pairIndex] = 0;
        usdc.transfer(msg.sender, collateral);
        return nextOrderId++;
    }

    function updateMargin(uint256 pairIndex, uint256, uint8 updateType, uint256 amount, bytes[] calldata, uint8)
        external
        payable
        returns (uint256)
    {
        if (updateType == 0) {
            usdc.transferFrom(msg.sender, address(this), amount);
            collateralOf[msg.sender][pairIndex] += amount;
        } else {
            collateralOf[msg.sender][pairIndex] -= amount;
            usdc.transfer(msg.sender, amount);
        }
        lastMargin = amount;
        lastValue = msg.value;
        return nextOrderId++;
    }
}

/// @dev Test double of Base Account's SpendPermissionManager, installed at its real address with
/// hardhat_setCode. The account pre-approves this contract on the token (a real Base Account lets
/// the manager move funds as one of its owners). Allowance is per permission over its lifetime.
contract MockSpendPermissionManager {
    mapping(bytes32 => bool) public approvedHash;
    mapping(bytes32 => uint256) public spent;

    function _hash(ISpendPermissionManager.SpendPermission calldata p) private pure returns (bytes32) {
        return keccak256(abi.encode(p.account, p.spender, p.token, p.allowance, p.period, p.start, p.end, p.salt, keccak256(p.extraData)));
    }

    function approveWithSignature(ISpendPermissionManager.SpendPermission calldata p, bytes calldata signature) external returns (bool) {
        require(keccak256(signature) == keccak256("owner-signed"), "bad signature");
        approvedHash[_hash(p)] = true;
        return true;
    }

    function isApproved(ISpendPermissionManager.SpendPermission calldata p) external view returns (bool) {
        return approvedHash[_hash(p)];
    }

    function spend(ISpendPermissionManager.SpendPermission calldata p, uint160 value) external {
        bytes32 h = _hash(p);
        require(msg.sender == p.spender, "InvalidSender");
        require(approvedHash[h], "UnauthorizedSpendPermission");
        require(spent[h] + value <= p.allowance, "ExceededSpendPermission");
        spent[h] += value;
        IERC20(p.token).transferFrom(p.account, p.spender, value);
    }
}
