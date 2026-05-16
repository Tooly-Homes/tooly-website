// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RWAMarketplace
/// @notice A non-custodial order book for RWA tokens. Sellers list tokens they
///         already hold (approving this contract as spender); buyers pay in the
///         chain's native coin. Tokens move directly seller -> buyer, so the RWA
///         token's own allowlist still governs who is allowed to receive them.
contract RWAMarketplace is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        address asset; // RWAAsset (ERC-20) token address
        uint256 amount; // token base units still available
        uint256 pricePerToken; // wei charged per 1e18 token base units
        bool active;
    }

    /// @notice Marketplace fee, in basis points, capped at 10%.
    uint96 public feeBps;
    address public feeRecipient;
    uint96 public constant MAX_FEE_BPS = 1000;

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed asset,
        uint256 amount,
        uint256 pricePerToken
    );
    event Purchased(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 cost);
    event ListingCancelled(uint256 indexed listingId);
    event FeeUpdated(uint96 feeBps, address feeRecipient);

    error InvalidAmount();
    error InvalidPrice();
    error ListingNotActive();
    error NotSeller();
    error InsufficientPayment();
    error FeeTooHigh();
    error TransferFailed();

    constructor(address initialOwner, uint96 feeBps_, address feeRecipient_) Ownable(initialOwner) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    function setFee(uint96 feeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }

    /// @notice List RWA tokens for sale. Caller must first approve this contract
    ///         to spend at least `amount` of `asset`.
    function list(
        address asset,
        uint256 amount,
        uint256 pricePerToken
    ) external returns (uint256 listingId) {
        if (amount == 0) revert InvalidAmount();
        if (pricePerToken == 0) revert InvalidPrice();

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            asset: asset,
            amount: amount,
            pricePerToken: pricePerToken,
            active: true
        });
        emit Listed(listingId, msg.sender, asset, amount, pricePerToken);
    }

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (l.seller != msg.sender) revert NotSeller();
        l.active = false;
        emit ListingCancelled(listingId);
    }

    /// @notice Buy `amount` token base units from a listing. Pays
    ///         `pricePerToken * amount / 1e18` wei; any excess is refunded.
    function buy(uint256 listingId, uint256 amount) external payable nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (amount == 0 || amount > l.amount) revert InvalidAmount();

        uint256 cost = (l.pricePerToken * amount) / 1e18;
        if (msg.value < cost) revert InsufficientPayment();

        // Effects: update listing state before any external interaction.
        l.amount -= amount;
        if (l.amount == 0) l.active = false;

        address seller = l.seller;
        address asset = l.asset;
        uint256 fee = (cost * feeBps) / 10_000;

        // Interactions: token moves seller -> buyer; the RWA token enforces its
        // own allowlist here, so a non-cleared buyer reverts the whole purchase.
        bool ok = IERC20(asset).transferFrom(seller, msg.sender, amount);
        if (!ok) revert TransferFailed();

        _send(seller, cost - fee);
        _send(feeRecipient, fee);
        _send(msg.sender, msg.value - cost);

        emit Purchased(listingId, msg.sender, amount, cost);
    }

    function _send(address to, uint256 value) private {
        if (value == 0) return;
        (bool ok, ) = payable(to).call{value: value}("");
        if (!ok) revert TransferFailed();
    }
}
