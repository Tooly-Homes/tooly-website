import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys an example tokenized real-world asset and the marketplace that trades it.
// Tune the parameters below (or override them with an Ignition parameters file)
// before deploying to a live testnet.
export default buildModule("RWADeploy", (m) => {
  const deployer = m.getAccount(0);

  const name = m.getParameter("name", "Downtown Office Tower Shares");
  const symbol = m.getParameter("symbol", "DOTS");
  const description = m.getParameter(
    "description",
    "Fractional ownership of a commercial office building",
  );
  const documentURI = m.getParameter("documentURI", "ipfs://replace-with-legal-docs");
  // Appraised value in USD cents: $250,000,000.00
  const valuation = m.getParameter("valuation", 25_000_000_000n);

  // Marketplace fee in basis points (100 = 1%).
  const feeBps = m.getParameter("feeBps", 100);

  const asset = m.contract("RWAAsset", [
    name,
    symbol,
    description,
    documentURI,
    valuation,
    deployer,
  ]);

  const marketplace = m.contract("RWAMarketplace", [deployer, feeBps, deployer]);

  return { asset, marketplace };
});
