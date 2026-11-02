import { concatHex, formatEther, getContractAddress, keccak256, parseAbi, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { publicClient, type createSmartAccount } from "./smartAccount";
import artifact from "./generated/eventDeployment.json";
import { getDeploymentRecord, reserveDeployment, updateDeployment, type DeploymentRecord } from "./eventDeploymentStore";
import { JPYC_ADDRESS } from "./jpyc";

// Demo organizer selected by the user. This UI restriction is not on-chain access control.
export const EVENT_ORGANIZER: Address = "0xF3B45d905b159C17baC29A9Bb8F2a04c731218d8";
export const DEPLOYMENT_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const FACTORY_CODE = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const initCode = artifact.initCode as Hex;
export const deploymentPlan = {
  initCodeHash: keccak256(initCode),
  salt: keccak256(stringToHex(`smart-wallet-demo:event:v1:${EVENT_ORGANIZER.toLowerCase()}`)),
};
export const EVENT_DEPLOYMENT_ADDRESS = getContractAddress({ from: DEPLOYMENT_FACTORY, opcode: "CREATE2", salt: deploymentPlan.salt, bytecode: initCode });
const calls = [{ to: DEPLOYMENT_FACTORY, value: BigInt(0), data: concatHex([deploymentPlan.salt, initCode]) }];
type SmartClient = Awaited<ReturnType<typeof createSmartAccount>>;

export function isEventOrganizer(owner: Address) { return owner.toLowerCase() === EVENT_ORGANIZER.toLowerCase(); }

async function assertConnection(client: SmartClient, owner: Address) {
  if (!isEventOrganizer(owner) || client.account.address.toLowerCase() !== owner.toLowerCase()) throw new Error("主催者のSmart Accountでログインしてください。");
  const [rpc, bundler] = await Promise.all([publicClient.getChainId(), client.getChainId()]);
  if (client.chain?.id !== 11155111 || rpc !== 11155111 || bundler !== 11155111) throw new Error("公開RPCとBundlerの接続先がSepoliaではありません。");
}

function assertPlan(record: DeploymentRecord) {
  if (record.address.toLowerCase() !== EVENT_DEPLOYMENT_ADDRESS.toLowerCase() || record.initCodeHash !== deploymentPlan.initCodeHash) {
    throw new Error("保存された設置内容と現在のプログラムが異なります。再送せず記録を確認してください。");
  }
}

export async function verifyEventDeployment() {
  const code = await publicClient.getCode({ address: EVENT_DEPLOYMENT_ADDRESS });
  if (!code || code === "0x") return false;
  if (code.toLowerCase() !== artifact.runtimeCode.toLowerCase()) throw new Error("設置先のプログラムが予定と一致しません。送信を中止します。");
  const token = await publicClient.readContract({ address: EVENT_DEPLOYMENT_ADDRESS, abi: parseAbi(["function jpyc() view returns (address)"]), functionName: "jpyc" });
  if (token.toLowerCase() !== JPYC_ADDRESS.toLowerCase()) throw new Error("配布するJPYCの設定が一致しません。");
  return true;
}

// Read-only preflight: no signature, send, or persistent reservation.
export async function prepareEventDeployment(client: SmartClient, owner: Address, activeAttempt?: string) {
  await assertConnection(client, owner);
  const record = await getDeploymentRecord(owner);
  if (record) {
    assertPlan(record);
    if (record.status !== "failed" && record.attemptId !== activeAttempt) throw new Error("設置済み、または結果未確認です。「設置状況を確認」を押してください。");
  }
  if (await verifyEventDeployment()) throw new Error("配布プログラムは設置済みです。「設置状況を確認」を押してください。");
  const factory = await publicClient.getCode({ address: DEPLOYMENT_FACTORY });
  if (factory?.toLowerCase() !== FACTORY_CODE) throw new Error("設置用の共通プログラムを確認できません。");
  await publicClient.call({ account: owner, ...calls[0] });
  const operation = await client.prepareUserOperation({ calls });
  if (!operation.paymaster || operation.paymaster === zeroAddress) throw new Error("設置のガス代スポンサーを確認できません。自己負担での送信はしません。");
  const gas = await client.estimateUserOperationGas({ ...operation });
  const totalGas = gas.callGasLimit + gas.verificationGasLimit + gas.preVerificationGas + (gas.paymasterVerificationGasLimit ?? BigInt(0)) + (gas.paymasterPostOpGasLimit ?? BigInt(0));
  return { operation, paymaster: operation.paymaster, estimatedMaxFee: formatEther(totalGas * operation.maxFeePerGas) };
}

async function confirmReceipt(client: SmartClient, record: DeploymentRecord, wait: boolean) {
  if (!record.operationHash) throw new Error("受付番号が不明です。設置先を確認できるまで再送しません。");
  const receipt = wait
    ? await client.waitForUserOperationReceipt({ hash: record.operationHash, timeout: 120_000 })
    : await client.getUserOperationReceipt({ hash: record.operationHash });
  if (!receipt) throw new Error("設置結果はまだ確定していません。時間をおいて照会してください。");
  if (receipt.sender.toLowerCase() !== record.owner.toLowerCase() || BigInt(receipt.nonce).toString() !== record.nonce) throw new Error("設置結果のアカウントまたはnonceが一致しません。");
  if (!receipt.success || receipt.receipt.status !== "success") {
    await updateDeployment(record, { status: "failed", transactionHash: receipt.receipt.transactionHash });
    throw new Error("設置処理の失敗を確認しました。もう一度事前確認からやり直せます。");
  }
  if (!await verifyEventDeployment()) throw new Error("設置先のプログラムをまだ確認できません。再送せず照会してください。");
  await updateDeployment(record, { status: "success", transactionHash: receipt.receipt.transactionHash });
}

export async function deployEvent(client: SmartClient, owner: Address, onSubmitted: (hash: Hex) => void) {
  await assertConnection(client, owner);
  const record: DeploymentRecord = {
    owner, address: EVENT_DEPLOYMENT_ADDRESS, initCodeHash: deploymentPlan.initCodeHash,
    attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), status: "processing",
  };
  await reserveDeployment(record);
  let started = false;
  try {
    const { operation } = await prepareEventDeployment(client, owner, record.attemptId);
    const nonce = operation.nonce.toString();
    await updateDeployment(record, { nonce });
    await assertConnection(client, owner);
    started = true;
    const operationHash = await client.sendUserOperation({ ...operation, signature: undefined });
    await updateDeployment(record, { operationHash });
    onSubmitted(operationHash);
    await confirmReceipt(client, { ...record, nonce, operationHash }, true);
    return getDeploymentRecord(owner);
  } catch (error) {
    await updateDeployment(record, { status: started ? "unknown" : "failed" });
    throw error;
  }
}

// Fixed CREATE2 address permits recovery even when a send response lost its hash.
export async function recoverEventDeployment(client: SmartClient, owner: Address) {
  await assertConnection(client, owner);
  const record = await getDeploymentRecord(owner);
  if (record) assertPlan(record);
  if (await verifyEventDeployment()) {
    if (record && record.status !== "failed") await updateDeployment(record, { status: "success" });
    return { deployed: true, record: await getDeploymentRecord(owner) };
  }
  if (!record || record.status === "failed") return { deployed: false, record };
  if (record.status === "success") throw new Error("以前確認したプログラムが現在見つかりません。再送せず接続を確認してください。");
  try { await confirmReceipt(client, record, false); }
  catch (error) { await updateDeployment(record, { status: "unknown" }); throw error; }
  return { deployed: true, record: await getDeploymentRecord(owner) };
}
