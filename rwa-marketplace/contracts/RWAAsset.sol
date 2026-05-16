// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RWAAsset
/// @notice Permissioned ERC-20 representing fractional ownership of a real-world asset.
///         Tokens may only be held or received by KYC-verified (allowlisted) accounts,
///         which is the core compliance requirement for most RWA tokens.
contract RWAAsset is ERC20, Ownable {
    struct AssetInfo {
        string description; // human-readable description of the underlying asset
        string documentURI; // link to legal docs / valuation report (e.g. ipfs://)
        uint256 valuation; // off-chain appraised value, in USD cents
    }

    AssetInfo public assetInfo;

    /// @notice Accounts cleared to hold the token. Only the owner (issuer) can change this.
    mapping(address => bool) public isAllowlisted;

    event AllowlistUpdated(address indexed account, bool allowed);
    event ValuationUpdated(uint256 valuation, string documentURI);

    error NotAllowlisted(address account);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory description_,
        string memory documentURI_,
        uint256 valuation_,
        address initialOwner
    ) ERC20(name_, symbol_) Ownable(initialOwner) {
        assetInfo = AssetInfo(description_, documentURI_, valuation_);
        isAllowlisted[initialOwner] = true;
        emit AllowlistUpdated(initialOwner, true);
    }

    function setAllowlisted(address account, bool allowed) external onlyOwner {
        isAllowlisted[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    function setAllowlistedBatch(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isAllowlisted[accounts[i]] = allowed;
            emit AllowlistUpdated(accounts[i], allowed);
        }
    }

    function updateValuation(uint256 valuation_, string calldata documentURI_) external onlyOwner {
        assetInfo.valuation = valuation_;
        assetInfo.documentURI = documentURI_;
        emit ValuationUpdated(valuation_, documentURI_);
    }

    /// @notice Issue new fractional shares. Recipient must already be allowlisted.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Redeem/retire shares held by the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @dev Enforces the allowlist on every mint, transfer and burn.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isAllowlisted[from]) revert NotAllowlisted(from);
        if (to != address(0) && !isAllowlisted[to]) revert NotAllowlisted(to);
        super._update(from, to, value);
    }
}
