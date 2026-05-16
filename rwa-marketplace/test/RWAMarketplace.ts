import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE = 10n ** 18n;

async function deployFixture() {
  const [issuer, seller, buyer, outsider, feeAccount] = await ethers.getSigners();

  const asset = await ethers.deployContract("RWAAsset", [
    "Downtown Office Tower Shares",
    "DOTS",
    "Fractional ownership of a commercial office building",
    "ipfs://legal-docs",
    25_000_000_000n,
    issuer.address,
  ]);

  // 1% fee, paid to feeAccount.
  const marketplace = await ethers.deployContract("RWAMarketplace", [
    issuer.address,
    100,
    feeAccount.address,
  ]);

  return { asset, marketplace, issuer, seller, buyer, outsider, feeAccount };
}

describe("RWAAsset", function () {
  it("blocks transfers to non-allowlisted accounts", async function () {
    const { asset, issuer, seller } = await deployFixture();

    await asset.connect(issuer).setAllowlisted(issuer.address, true);
    await expect(asset.connect(issuer).mint(seller.address, ONE)).to.be.revertedWithCustomError(
      asset,
      "NotAllowlisted",
    );

    await asset.connect(issuer).setAllowlisted(seller.address, true);
    await asset.connect(issuer).mint(seller.address, ONE);
    expect(await asset.balanceOf(seller.address)).to.equal(ONE);
  });

  it("only the owner can manage the allowlist", async function () {
    const { asset, seller } = await deployFixture();
    await expect(
      asset.connect(seller).setAllowlisted(seller.address, true),
    ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
  });
});

describe("RWAMarketplace", function () {
  it("settles a purchase, paying seller and fee recipient", async function () {
    const { asset, marketplace, issuer, seller, buyer, feeAccount } = await deployFixture();

    await asset.connect(issuer).setAllowlistedBatch([seller.address, buyer.address], true);
    await asset.connect(issuer).mint(seller.address, 100n * ONE);

    // Seller approves the marketplace and lists 40 tokens at 0.01 ETH each.
    const price = ethers.parseEther("0.01");
    await asset.connect(seller).approve(await marketplace.getAddress(), 100n * ONE);
    await marketplace.connect(seller).list(await asset.getAddress(), 40n * ONE, price);

    const buyAmount = 10n * ONE;
    const cost = (price * buyAmount) / ONE; // 0.1 ETH
    const fee = (cost * 100n) / 10_000n; // 1%

    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const feeBefore = await ethers.provider.getBalance(feeAccount.address);

    await expect(marketplace.connect(buyer).buy(0, buyAmount, { value: cost }))
      .to.emit(marketplace, "Purchased")
      .withArgs(0, buyer.address, buyAmount, cost);

    expect(await asset.balanceOf(buyer.address)).to.equal(buyAmount);
    expect(await ethers.provider.getBalance(seller.address)).to.equal(
      sellerBefore + cost - fee,
    );
    expect(await ethers.provider.getBalance(feeAccount.address)).to.equal(feeBefore + fee);

    const listing = await marketplace.listings(0);
    expect(listing.amount).to.equal(30n * ONE);
    expect(listing.active).to.equal(true);
  });

  it("refunds overpayment", async function () {
    const { asset, marketplace, issuer, seller, buyer } = await deployFixture();

    await asset.connect(issuer).setAllowlistedBatch([seller.address, buyer.address], true);
    await asset.connect(issuer).mint(seller.address, 10n * ONE);

    const price = ethers.parseEther("0.01");
    await asset.connect(seller).approve(await marketplace.getAddress(), 10n * ONE);
    await marketplace.connect(seller).list(await asset.getAddress(), 10n * ONE, price);

    const cost = price; // buying exactly 1 token
    const buyerBefore = await ethers.provider.getBalance(buyer.address);

    const tx = await marketplace.connect(buyer).buy(0, ONE, { value: cost * 5n });
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;

    expect(await ethers.provider.getBalance(buyer.address)).to.equal(
      buyerBefore - cost - gas,
    );
  });

  it("rejects a purchase by a non-allowlisted buyer", async function () {
    const { asset, marketplace, issuer, seller, outsider } = await deployFixture();

    await asset.connect(issuer).setAllowlisted(seller.address, true);
    await asset.connect(issuer).mint(seller.address, 10n * ONE);

    const price = ethers.parseEther("0.01");
    await asset.connect(seller).approve(await marketplace.getAddress(), 10n * ONE);
    await marketplace.connect(seller).list(await asset.getAddress(), 10n * ONE, price);

    await expect(
      marketplace.connect(outsider).buy(0, ONE, { value: price }),
    ).to.be.revertedWithCustomError(asset, "NotAllowlisted");
  });

  it("reverts when payment is insufficient", async function () {
    const { asset, marketplace, issuer, seller, buyer } = await deployFixture();

    await asset.connect(issuer).setAllowlistedBatch([seller.address, buyer.address], true);
    await asset.connect(issuer).mint(seller.address, 10n * ONE);

    const price = ethers.parseEther("0.01");
    await asset.connect(seller).approve(await marketplace.getAddress(), 10n * ONE);
    await marketplace.connect(seller).list(await asset.getAddress(), 10n * ONE, price);

    await expect(
      marketplace.connect(buyer).buy(0, ONE, { value: price - 1n }),
    ).to.be.revertedWithCustomError(marketplace, "InsufficientPayment");
  });

  it("lets only the seller cancel, and blocks buys afterwards", async function () {
    const { asset, marketplace, issuer, seller, buyer } = await deployFixture();

    await asset.connect(issuer).setAllowlistedBatch([seller.address, buyer.address], true);
    await asset.connect(issuer).mint(seller.address, 10n * ONE);

    const price = ethers.parseEther("0.01");
    await asset.connect(seller).approve(await marketplace.getAddress(), 10n * ONE);
    await marketplace.connect(seller).list(await asset.getAddress(), 10n * ONE, price);

    await expect(marketplace.connect(buyer).cancel(0)).to.be.revertedWithCustomError(
      marketplace,
      "NotSeller",
    );

    await expect(marketplace.connect(seller).cancel(0))
      .to.emit(marketplace, "ListingCancelled")
      .withArgs(0);

    await expect(
      marketplace.connect(buyer).buy(0, ONE, { value: price }),
    ).to.be.revertedWithCustomError(marketplace, "ListingNotActive");
  });
});
