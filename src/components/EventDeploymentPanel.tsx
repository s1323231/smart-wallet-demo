"use client";

import { useEffect, useRef, useState } from "react";
import { BaseError, type Address } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { DEPLOYMENT_FACTORY, EVENT_DEPLOYMENT_ADDRESS, deployEvent, isEventOrganizer, prepareEventDeployment, recoverEventDeployment } from "@/lib/eventDeployment";
import { getDeploymentRecord, type DeploymentRecord } from "@/lib/eventDeploymentStore";

type Preview = Awaited<ReturnType<typeof prepareEventDeployment>>;
const button = "w-full rounded-2xl bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-50";

export function EventDeploymentPanel({ address }: { address: Address }) {
  const { smartAccountClient } = useWallet();
  const [record, setRecord] = useState<DeploymentRecord | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const confirmationOpen = useRef(false);
  const previewRef = useRef<Preview | null>(null);
  const blocked = !storageReady || deployed || (record !== null && record.status !== "failed");
  const installedAddress = deployed ? EVENT_DEPLOYMENT_ADDRESS : record?.status === "success" ? record.address : null;

  useEffect(() => {
    if (!isEventOrganizer(address)) return;
    let active = true;
    const refresh = async () => {
      try {
        const saved = await getDeploymentRecord(address);
        if (active) { setRecord(saved); setStorageReady(true); }
      } catch {
        if (active) { setStorageReady(false); setMessage("設置記録を読み込めません。保存領域を確認してください。"); }
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [address]);

  if (!isEventOrganizer(address)) return null;

  const clearPreview = () => { previewRef.current = null; setPreview(null); confirmationOpen.current = false; setConfirming(false); };
  const perform = async (action: "prepare" | "send" | "recover") => {
    if (lock.current || !smartAccountClient) return;
    if (action !== "recover" && blocked) return;
    if (action === "send" && (!confirmationOpen.current || !previewRef.current)) return;
    lock.current = true; setBusy(true); clearPreview();
    setMessage(action === "prepare" ? "設置内容・スポンサー・手数料を確認しています…（送信しません）" : action === "send" ? "条件を再確認し、設置を進めています。画面を閉じずにお待ちください。" : "設置先と保存済みの結果を確認しています…（送信しません）");
    try {
      if (action === "prepare") {
        const result = await prepareEventDeployment(smartAccountClient, address);
        previewRef.current = result; setPreview(result);
        setMessage("事前確認が通りました。まだ設置していません。内容を確認してから進めてください。");
      } else if (action === "send") {
        const saved = await deployEvent(smartAccountClient, address, () => setMessage("送信済みです。設置先のプログラムを確認しています…"));
        setRecord(saved); setDeployed(true);
        setMessage("配布プログラムの設置を確認しました。利用開始にはアプリの配布先設定とJPYCの補充が必要です。");
      } else {
        const result = await recoverEventDeployment(smartAccountClient, address);
        setRecord(result.record); setDeployed(result.deployed);
        setMessage(result.deployed ? "予定した配布プログラムがSepoliaに設置されていることを確認しました。" : result.record?.status === "failed" ? "送信前の中止、または設置失敗を確認済みです。再実行には事前確認からやり直してください。" : "設置記録はありません。事前確認から進められます。");
      }
    } catch (error) {
      const detail = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "通信エラー";
      setMessage(`${action === "prepare" ? "事前確認に失敗しました。" : action === "send" ? "設置完了を確認できませんでした。" : "設置状況を確定できませんでした。"}${detail} 結果不明の場合は再送せず「設置状況を確認」を使ってください。`);
    } finally {
      try { setRecord(await getDeploymentRecord(address)); setStorageReady(true); }
      catch { setStorageReady(false); }
      lock.current = false; setBusy(false);
    }
  };

  return (
    <details className="rounded-3xl border border-line bg-surface p-6 shadow-soft">
      <summary className="cursor-pointer font-semibold text-accent">主催者用：配布プログラムの設置</summary>
      <div className="mt-5 space-y-4 text-sm">
        <p>今のGoogleログインとSmart Accountを使い、Sepoliaにイベント用の配布プログラムを設置します。秘密鍵の入力は不要です。</p>
        <p className="text-muted">1人につきテスト用1 JPYCと参加証NFTを配れる仕組みです。利用開始にはアプリの配布先設定とJPYCの補充が必要です。</p>
        <p className="text-muted">ガス代スポンサーを確認できた場合だけ送信します。自己負担送信への自動切り替えはしません。</p>
        <p>設置状態：{!storageReady ? "保存記録を確認中" : deployed ? "設置確認済み" : record ? ({ processing: "処理中", unknown: "結果不明", success: "以前の設置確認済み（現在の状況は照会してください）", failed: "失敗確認済み（送信前中止を含む）" })[record.status] : "設置記録なし"}</p>
        <button type="button" disabled={busy || blocked || !smartAccountClient || confirming} onClick={() => perform("prepare")} className={button}>設置条件・スポンサーを事前確認（送信しません）</button>
        {preview && <>
          <p>スポンサー応答・ガス見積もり成功。スポンサー負担の手数料見積もり上限：{preview.estimatedMaxFee} SepoliaETH（確定額ではありません）。</p>
          <button type="button" disabled={busy || blocked || confirming} onClick={() => {
            if (lock.current || !previewRef.current) return;
            confirmationOpen.current = true; setConfirming(true);
          }} className={button}>設置内容を確認する</button>
        </>}
        {confirming && preview && <section role="dialog" aria-labelledby="event-deploy-confirm-title" className="space-y-4 rounded-2xl border border-line p-4">
          <h3 id="event-deploy-confirm-title" className="font-semibold">配布プログラム設置の最終確認</h3>
          <dl className="space-y-3 break-all">
            <div><dt>ネットワーク</dt><dd>Ethereum Sepolia</dd></div>
            <div><dt>操作するSmart Account</dt><dd>{address}</dd></div>
            <div><dt>設置するもの</dt><dd>1 JPYCと参加証NFTを配布する、1イベント用プログラム</dd></div>
            <div><dt>設置予定アドレス</dt><dd>{EVENT_DEPLOYMENT_ADDRESS}</dd></div>
            <div><dt>ETH送付額</dt><dd>0 ETH</dd></div>
            <div><dt>ガス代スポンサー</dt><dd>{preview.paymaster}</dd></div>
            <div><dt>スポンサー負担の手数料見積もり上限</dt><dd>{preview.estimatedMaxFee} SepoliaETH</dd></div>
          </dl>
          <p>実行直前にスポンサーと手数料を再確認します。見積もりは変動します。設置はネットワークに記録され、取り消せません。</p>
          <button type="button" disabled={busy || blocked} onClick={() => perform("send")} className={button}>この内容でSepoliaに設置する</button>
          <button type="button" disabled={busy} onClick={() => { confirmationOpen.current = false; setConfirming(false); }} className="text-accent underline">キャンセル</button>
        </section>}
        <button type="button" disabled={busy || !storageReady || !smartAccountClient} onClick={() => perform("recover")} className="text-accent underline disabled:opacity-50">設置状況を確認（送信しません）</button>
        <p role="status" className="break-words" aria-live="polite">{message}</p>
        {installedAddress && <div className="space-y-3 rounded-2xl bg-soft p-4">
          <p className="font-semibold">配布プログラムのアドレス</p>
          <p className="break-all font-mono text-xs">{installedAddress}</p>
          <a className="text-accent underline" href={`https://sepolia.etherscan.io/address/${installedAddress}`} target="_blank" rel="noopener noreferrer">Sepolia Etherscanで見る</a>
          <p>このアドレスをアプリの配布先に設定し、必要人数分のテスト用JPYCを補充すると、参加登録から特典を配布できます。</p>
        </div>}
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">設置の確認情報</summary>
          <div className="mt-2 space-y-2 break-all">
            <p>設置用の共通プログラム：{DEPLOYMENT_FACTORY}</p>
            <p>設置予定アドレス：{EVENT_DEPLOYMENT_ADDRESS}</p>
            {record && <p>開始日時：{record.startedAt} / nonce：{record.nonce ?? "未取得"}</p>}
            {record?.operationHash && <p>UserOperation：{record.operationHash}</p>}
            {record?.transactionHash && <a className="text-accent underline" href={`https://sepolia.etherscan.io/tx/${record.transactionHash}`} target="_blank" rel="noopener noreferrer">設置取引：{record.transactionHash}</a>}
            <p>保存記録はこのブラウザ内にあります。結果不明時は記録を削除せず照会してください。設置予定アドレスは同じプログラムでは固定です。</p>
          </div>
        </details>
      </div>
    </details>
  );
}
