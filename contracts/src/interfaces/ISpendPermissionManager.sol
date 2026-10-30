// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The parts of Base Account's SpendPermissionManager a vault calls. A spend permission is
/// signed by a Base Account (`account`) and lets `spender` pull up to `allowance` of `token` per
/// `period` seconds between `start` and `end`; `spend` sends the tokens to the spender.
interface ISpendPermissionManager {
    struct SpendPermission {
        address account;
        address spender;
        address token;
        uint160 allowance;
        uint48 period;
        uint48 start;
        uint48 end;
        uint256 salt;
        bytes extraData;
    }

    function approveWithSignature(SpendPermission calldata spendPermission, bytes calldata signature) external returns (bool);
    function isApproved(SpendPermission calldata spendPermission) external view returns (bool);
    function spend(SpendPermission calldata spendPermission, uint160 value) external;
}
