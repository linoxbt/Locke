// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LockeVault} from "./LockeVault.sol";
import {IVerantaRouter, IVerantaTradingStorage} from "./interfaces/IVeranta.sol";

/**
 * @title LockeVaultFactory
 * @notice Deploys one LockeVault clone per business. The caller becomes the vault's owner, so a
 * vault is always created by, and belongs to, the business's own wallet.
 */
contract LockeVaultFactory {
    using SafeERC20 for IERC20;

    struct PlanInit {
        uint256 pairIndex;
        bool buy;
        uint64 maxLeverage;
        uint128 maxNotional;
    }

    address public immutable implementation;
    address public immutable keeper;
    address public immutable guardian;
    IERC20 public immutable usdc;
    IVerantaRouter public immutable router;
    IVerantaTradingStorage public immutable tradingStorage;

    event VaultCreated(address indexed owner, address indexed vault, uint256 indexed pairIndex, bool buy, uint128 maxNotional);

    constructor(address keeper_, address guardian_, IERC20 usdc_, IVerantaRouter router_, IVerantaTradingStorage tradingStorage_) {
        implementation = address(new LockeVault());
        keeper = keeper_;
        guardian = guardian_;
        usdc = usdc_;
        router = router_;
        tradingStorage = tradingStorage_;
    }

    /// @notice Create a vault owned by the caller with its first plan, and fund it in the same call
    /// (needs a USDC approval to this factory for `deposit`; pass 0 to fund later).
    function createVault(PlanInit calldata plan, uint256 deposit) external returns (LockeVault vault) {
        vault = LockeVault(payable(Clones.clone(implementation)));
        // The factory owns the vault for the length of this call to set the plan, then hands it over.
        vault.initialize(address(this), keeper, guardian, usdc, router, tradingStorage);
        vault.setPlan(plan.pairIndex, true, plan.buy, plan.maxLeverage, plan.maxNotional);
        vault.transferOwnership(msg.sender);
        if (deposit != 0) {
            usdc.safeTransferFrom(msg.sender, address(vault), deposit);
        }
        emit VaultCreated(msg.sender, address(vault), plan.pairIndex, plan.buy, plan.maxNotional);
    }
}
