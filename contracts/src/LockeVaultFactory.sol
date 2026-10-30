// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LockeVault} from "./LockeVault.sol";
import {IVerantaRouter, IVerantaTradingStorage} from "./interfaces/IVeranta.sol";

/**
 * @title LockeVaultFactory
 * @notice Deploys one LockeVault clone per business, owned by the caller, and holds what Locke
 * runs for all vaults:
 *  - admin (Locke multisig): sets the guardian, the keeper and fee for new vaults, the fee
 *    collector and the launch deposit caps; two-step handover;
 *  - guardian: pauses new deposits and new hedges for all vaults or one vault, and revokes a
 *    compromised keeper key for every vault at once (only the admin restores it); never exits.
 * Nothing here can move a vault's USDC or block a withdrawal, close or top-up.
 */
contract LockeVaultFactory {
    using SafeERC20 for IERC20;

    address public immutable implementation;
    IERC20 public immutable usdc;
    IVerantaRouter public immutable router;
    IVerantaTradingStorage public immutable tradingStorage;

    address public admin;
    address public pendingAdmin;
    address public guardian;
    bool public paused;

    /// @notice Keeper and fee given to vaults created from now on. A vault's own owner changes its keeper.
    address public keeper;
    uint16 public feeBps;
    address public feeCollector;

    /// @notice Launch caps on deposits less withdrawals: per vault, and across all vaults.
    uint256 public maxVaultDeposits;
    uint256 public maxTotalDeposits;
    uint256 public totalDeposits;

    mapping(address => bool) public isVault;
    /// @notice Keeper keys no vault accepts any more (read by every vault's keeper check).
    mapping(address => bool) public keeperRevoked;
    uint256 public vaultCount;

    event VaultCreated(address indexed owner, address indexed vault, uint256 indexed pairIndex, bool buy, uint128 maxNotional, uint16 feeBps);
    event AdminTransferStarted(address indexed from, address indexed to);
    event AdminSet(address indexed admin);
    event GuardianSet(address indexed guardian);
    event KeeperSet(address indexed keeper);
    event FeeSet(uint16 feeBps, address indexed collector);
    event CapsSet(uint256 maxVaultDeposits, uint256 maxTotalDeposits);
    event Paused(bool paused);
    event KeeperRevoked(address indexed keeper, bool revoked);
    event DepositRecorded(address indexed vault, uint256 amount, uint256 totalDeposits);
    event WithdrawRecorded(address indexed vault, uint256 amount, uint256 totalDeposits);

    error NotAdmin();
    error NotPendingAdmin();
    error NotGuardian();
    error NotVault();
    error IsPaused();
    error VaultCapReached();
    error TotalCapReached();
    error FeeTooHigh();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address admin_,
        address guardian_,
        address keeper_,
        IERC20 usdc_,
        IVerantaRouter router_,
        IVerantaTradingStorage tradingStorage_,
        uint256 maxVaultDeposits_,
        uint256 maxTotalDeposits_
    ) {
        if (admin_ == address(0) || guardian_ == address(0) || address(usdc_) == address(0)) revert ZeroAddress();
        if (address(router_) == address(0) || address(tradingStorage_) == address(0)) revert ZeroAddress();
        implementation = address(new LockeVault());
        usdc = usdc_;
        router = router_;
        tradingStorage = tradingStorage_;
        admin = admin_;
        guardian = guardian_;
        keeper = keeper_;
        maxVaultDeposits = maxVaultDeposits_;
        maxTotalDeposits = maxTotalDeposits_;
        emit AdminSet(admin_);
        emit GuardianSet(guardian_);
        emit KeeperSet(keeper_);
        emit CapsSet(maxVaultDeposits_, maxTotalDeposits_);
    }

    // ------------------------------------------------------------------ businesses

    /**
     * @notice Create a vault owned by the caller with its first plan, and fund it in the same call
     * (needs a USDC approval to this factory for `deposit`; pass 0 to fund later).
     */
    function createVault(uint256 pairIndex, LockeVault.Plan calldata plan, uint256 deposit) external returns (LockeVault vault) {
        if (paused) revert IsPaused();
        vault = LockeVault(payable(Clones.clone(implementation)));
        isVault[address(vault)] = true;
        vaultCount += 1;
        emit VaultCreated(msg.sender, address(vault), pairIndex, plan.buy, plan.maxNotional, feeBps);
        vault.initialize(msg.sender, keeper, feeBps, pairIndex, plan, usdc, router, tradingStorage);
        if (deposit != 0) {
            // Through the vault's own deposit, so the launch caps count it.
            usdc.safeTransferFrom(msg.sender, address(this), deposit);
            usdc.forceApprove(address(vault), deposit);
            vault.deposit(deposit);
        }
    }

    // ------------------------------------------------------------------ vault accounting

    /// @dev Called by a vault before it takes a deposit; reverts above either cap.
    function recordDeposit(uint256 amount, uint256 vaultNetDeposits) external {
        if (!isVault[msg.sender]) revert NotVault();
        if (vaultNetDeposits > maxVaultDeposits) revert VaultCapReached();
        if (totalDeposits + amount > maxTotalDeposits) revert TotalCapReached();
        totalDeposits += amount;
        emit DepositRecorded(msg.sender, amount, totalDeposits);
    }

    /// @dev Called by a vault on withdrawal. Never reverts for a vault, so it can never block an exit.
    function recordWithdraw(uint256 amount) external {
        if (!isVault[msg.sender]) revert NotVault();
        totalDeposits = amount < totalDeposits ? totalDeposits - amount : 0;
        emit WithdrawRecorded(msg.sender, amount, totalDeposits);
    }

    // ------------------------------------------------------------------ Locke

    function setGuardian(address guardian_) external onlyAdmin {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setKeeper(address keeper_) external onlyAdmin {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Fee for vaults created from now on (existing vaults keep theirs), and where all fees go.
    function setFee(uint16 feeBps_, address collector) external onlyAdmin {
        if (feeBps_ > LockeVault(payable(implementation)).MAX_FEE_BPS()) revert FeeTooHigh();
        if (feeBps_ != 0 && collector == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeCollector = collector;
        emit FeeSet(feeBps_, collector);
    }

    function setCaps(uint256 maxVaultDeposits_, uint256 maxTotalDeposits_) external onlyAdmin {
        maxVaultDeposits = maxVaultDeposits_;
        maxTotalDeposits = maxTotalDeposits_;
        emit CapsSet(maxVaultDeposits_, maxTotalDeposits_);
    }

    function transferAdmin(address to) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        pendingAdmin = to;
        emit AdminTransferStarted(admin, to);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminSet(msg.sender);
    }

    /**
     * @notice Revoke a keeper key for every vault (guardian or admin), or restore it (admin only).
     * Owners' own functions never depend on it.
     */
    function setKeeperRevoked(address keeper_, bool revoked) external {
        if (revoked) {
            if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
        } else if (msg.sender != admin) {
            revert NotAdmin();
        }
        keeperRevoked[keeper_] = revoked;
        emit KeeperRevoked(keeper_, revoked);
    }

    /// @notice Stop new vaults, deposits and hedges everywhere. Exits keep working.
    function setPaused(bool paused_) external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = paused_;
        emit Paused(paused_);
    }
}
