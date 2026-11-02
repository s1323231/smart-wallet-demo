import { parseAbi, type Address } from "viem";
import { publicClient } from "./smartAccount";
import { EVENT_ADDRESS } from "./eventRewards";

export const ERC721_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function certificateOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export const ERC1155_ABI = parseAbi([
  "function uri(uint256 id) view returns (string)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

export type NftToken = {
  tokenId: bigint;
  tokenURI?: string;
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
  };
  balance?: bigint;
};

function resolveIpfsUrl(url: string): string {
  return url.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${url.slice(7)}`
    : url;
}

async function fetchTokenMetadata(uri: string): Promise<NftToken["metadata"]> {
  try {
    const res = await fetch(resolveIpfsUrl(uri));
    if (!res.ok) return undefined;
    const json = await res.json();
    return {
      name: json.name,
      description: json.description,
      image: json.image ? resolveIpfsUrl(String(json.image)) : undefined,
    };
  } catch {
    return undefined;
  }
}

// Alchemy NFT API (eth_getLogs の代替 — 無料プランでも利用可能)
async function fetchAlchemyNfts(
  contractAddress: Address,
  ownerAddress: Address
): Promise<NftToken[]> {
  const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_ALCHEMY_API_KEY が設定されていません");

  const base = `https://eth-sepolia.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner`;
  const tokens: NftToken[] = [];
  let pageKey: string | undefined;

  do {
    const url = new URL(base);
    url.searchParams.set("owner", ownerAddress);
    url.searchParams.append("contractAddresses[]", contractAddress);
    url.searchParams.set("withMetadata", "true");
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Alchemy NFT API ${res.status}: ${body}`);
    }
    const data = await res.json();

    for (const nft of data.ownedNfts ?? []) {
      const tokenId = BigInt(nft.tokenId);
      const imageUrl =
        nft.image?.cachedUrl ??
        nft.image?.originalUrl ??
        nft.raw?.metadata?.image;
      tokens.push({
        tokenId,
        tokenURI: nft.raw?.tokenUri,
        metadata: {
          name: nft.name ?? nft.raw?.metadata?.name,
          description: nft.description ?? nft.raw?.metadata?.description,
          image: imageUrl ? resolveIpfsUrl(String(imageUrl)) : undefined,
        },
        // ERC-1155 の場合 balance が返る、ERC-721 は undefined
        balance: nft.balance !== undefined ? BigInt(nft.balance) : undefined,
      });
    }

    pageKey = data.pageKey;
  } while (pageKey);

  return tokens;
}

export async function getErc721Tokens(
  contractAddress: Address,
  ownerAddress: Address
): Promise<{ tokens: NftToken[]; contractName: string; contractSymbol: string }> {
  const [balance, contractName, contractSymbol] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [ownerAddress],
    }),
    publicClient
      .readContract({ address: contractAddress, abi: ERC721_ABI, functionName: "name" })
      .catch(() => ""),
    publicClient
      .readContract({ address: contractAddress, abi: ERC721_ABI, functionName: "symbol" })
      .catch(() => ""),
  ]);

  // The event certificate is known by registration ID, without waiting for NFT indexing.
  if (EVENT_ADDRESS && contractAddress.toLowerCase() === EVENT_ADDRESS.toLowerCase() && balance === BigInt(1)) {
    const id = await publicClient.readContract({ address: contractAddress, abi: ERC721_ABI, functionName: "certificateOf", args: [ownerAddress] });
    if (id > BigInt(0)) {
      const owner = await publicClient.readContract({ address: contractAddress, abi: ERC721_ABI, functionName: "ownerOf", args: [id] });
      if (owner.toLowerCase() === ownerAddress.toLowerCase()) {
        const uri = await publicClient.readContract({ address: contractAddress, abi: ERC721_ABI, functionName: "tokenURI", args: [id] });
        return { tokens: [{ tokenId: id, tokenURI: uri, metadata: await fetchTokenMetadata(uri) }], contractName, contractSymbol };
      }
    }
  }

  // ERC721Enumerable を試みる（eth_call なので Alchemy 制限なし）
  const tokenIds: bigint[] = [];
  let enumerableFailed = false;

  for (let i = BigInt(0); i < balance && i < BigInt(100); i++) {
    try {
      const id = await publicClient.readContract({
        address: contractAddress,
        abi: ERC721_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [ownerAddress, i],
      });
      tokenIds.push(id);
    } catch {
      enumerableFailed = true;
      break;
    }
  }

  if (enumerableFailed) {
    // ERC721Enumerable 非対応 → Alchemy NFT API にフォールバック
    const alchemyTokens = await fetchAlchemyNfts(contractAddress, ownerAddress);
    return { tokens: alchemyTokens, contractName, contractSymbol };
  }

  // ERC721Enumerable 成功 → tokenURI とメタデータを取得
  const tokens = await Promise.all(
    tokenIds.map(async (tokenId) => {
      let tokenURI: string | undefined;
      let metadata: NftToken["metadata"];
      try {
        tokenURI = await publicClient.readContract({
          address: contractAddress,
          abi: ERC721_ABI,
          functionName: "tokenURI",
          args: [tokenId],
        });
        metadata = await fetchTokenMetadata(tokenURI);
      } catch {}
      return { tokenId, tokenURI, metadata };
    })
  );

  return { tokens, contractName, contractSymbol };
}

export async function getErc1155Tokens(
  contractAddress: Address,
  ownerAddress: Address
): Promise<{ tokens: NftToken[] }> {
  // ERC-1155 はイベントログが必要だが Alchemy 無料プランでは制限されるため、
  // Alchemy NFT API を使用する
  const tokens = await fetchAlchemyNfts(contractAddress, ownerAddress);
  return { tokens: tokens.sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1)) };
}
