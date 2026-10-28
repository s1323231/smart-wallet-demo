# LIVEの思い出 — イベント参加特典

先生のInapp Walletを土台に、ログイン後の画面へ「イベント参加登録」を追加しています。
Googleログイン・残高表示・ETH送金・ERC-20・JPYC・NFT表示は引き続き利用できます。
従来の参加記録は「これまでの参加記録」から開けます。

追加した参加登録は**画面プレビュー**です。ニックネーム入力 → 内容確認 → 登録完了を試せます。
このフォームの入力は保存・送信されず、フォームからのJPYC送金・NFT発行も行いません。
既存ウォレットの送金機能は実際のSepolia上で動作します。

実配布用の `EventCheckIn` と配布コントラクトは、参加登録フォームにまだ接続していません。
接続時の主催者向け手順と制約は [イベント設定ガイド](docs/event-setup.md) を参照してください。

以下はベースとなるInapp Walletと追加済みのJPYC機能の資料です。

## JPYCの残高・受取確認

ログイン後の「テスト用JPYC（Sepolia）」で、Smart Accountの残高と受取先を表示します。
残高が0でも表示されます。既存のAlchemy設定を使用し、追加のAPIキーは不要です。

対象はJPYC公式の[開発者ドキュメント](https://faq.jpyc.co.jp/s/article/developer-documentation)で
Ethereum Sepolia用として掲載されている `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` のみです。
アドレスは `src/lib/jpyc.ts` の `JPYC_ADDRESS` に定義しています。
別のコントラクトから配布された同名トークンは対象になりません。

1. Sepolia上で、対象JPYCを画面のSmart Accountアドレスへ送ります。
2. 確定後、その送金の取引ハッシュを入力して「JPYCの受取を確認」を押します。
3. 成功した取引のうち、対象コントラクトが出した自分宛ての正の金額の `Transfer` ログを確認します。
   同一取引に複数ある場合は合計額と送付元一覧を表示します。
4. 受取日時・金額・送付元・Etherscanリンクが保存され、残高も再取得されます。
5. 再読み込みして履歴が残ること、同じハッシュを再入力すると重複登録されないことを確認します。
   別の受取先、別トークン、失敗した取引、不正なハッシュは登録されません。

履歴は確認した取引のみで、過去の全取引を自動検索するものではありません。
ネットワーク・JPYCコントラクト・ウォレット別に、このブラウザのlocalStorageへ保存します。
ブラウザのデータを消すと履歴も消えます。保存履歴は以前の検証結果であり、読み込み時の再検証は行いません。
### 公式Faucetから取得

「取得条件・スポンサーを事前確認」→「テスト用JPYCを取得」→最終確認画面の「この内容で取得する」で、接続中のSmart Account自身に1 JPYCを取得します。
最終確認画面にはネットワーク・受取先・取得量・Faucet送信先・sendToken・ETH送付額0・事前確認のスポンサー結果を表示します。
スポンサー結果が得られていない場合は「未確認」と表示します。「キャンセル」では署名・送信を行いません。
公式Faucetと同じ利用規約・契約締結前交付書面兼説明書・プライバシーポリシーを確認し、同意してください。

- 根拠：[公式Faucet](https://faucet.jpyc.co.jp/)のSepolia設定・公開ABIと、[検証済みコントラクト](https://sepolia.etherscan.io/address/0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5#code)。
- Faucetは `0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5`、取得関数は `sendToken(address,uint256)`。
  検証済みソースでは受取先と呼出元の一致が必須で、EOA限定のチェックはありません。
- 毎回チェーン上の配布トークン、停止状態、許可リスト、取得間隔、取得前残高上限、1回の上限、Faucet残高を確認します。
  値は変更され得るため、固定の取得制限には依存しません。
- Smart Accountを呼出元とした `eth_call` に加え、デプロイ情報を含むUserOperationを準備し、Pimlicoスポンサーの応答とガス見積もりを確認します。
  確認が通らなければ送信しません。送信直前にも再確認します。事前確認は確定時の成功を保証しません。
- ダミー署名は送らず、既存Web3Authの所有者で署名します。新しいウォレットや秘密鍵の入力は不要です。
- UserOperationの確定、成功フラグ、対象JPYCの自分宛てTransferログを確認した場合だけ受取成功を表示し、残高を再取得します。
  表示された取引ハッシュを既存の受取確認欄に入力すると履歴に保存できます。
- 送信後のタイムアウトは結果未確認として扱い、取得できたUserOperationハッシュを表示して同じ画面での再送信を止めます。
  署名・送信開始後に応答を失ってハッシュが得られない場合も、未送信とは断定せず再送信を止めます。
  確定待ちの間は再読み込みして再取得せず、Pimlicoのダッシュボード等でUserOperationの結果を確認してください。

#### 永続ロックと復旧

取得直前に、公開RPCとBundlerそれぞれへ `eth_chainId` を問い合わせ、両方がSepolia（11155111）であることを確認します。
これは接続先ネットワークの照合であり、Paymasterが確実にガス代を負担する保証とは別です。
Paymaster情報の取得・ガス見積もりも別途確認し、自己負担送信へのフォールバックは行いません。

同じオリジンのIndexedDB（`jpyc-faucet-claims`）に、チェーン・Smart Account・Faucet・JPYC別の取得状態を保存します。
別タブ同士の照会と予約はreadwriteトランザクションで排他し、保存できなければ送信しません。
保存対象は開始日時、識別子、対象アドレス、期待金額・decimals、nonce、開始ブロック、取得できたUserOperation／取引ハッシュだけです。
秘密鍵・シードフレーズ・所有者署名・署名済みUserOperation・同意記録は保存しません。

| 保存状態 | 動作 |
|---|---|
| 処理中 | 取得準備から確定確認まで。他タブ・再読み込み後の再送も拒否 |
| 結果不明 | ハッシュ不明、送信後の通信失敗、未確定、受取条件不一致。ロック維持 |
| 成功確認済み | UserOperation・レシート成功、対象JPYC、Faucet送付元、自分宛て、decimals=18、合計が正確に1 JPYCを検証済み |
| 失敗確認済み | 署名・送信前に中止できた、またはレシートで失敗を確認。自動再送せず、再取得には事前確認・同意・最終確認が必要 |

再読み込み時は保存状態を読み取り、未解決なら取得を止めます。「保存状態を確認・復旧（送信しません）」は結果照会だけを行います。
ハッシュがあればレシートを照会して厳密な受取確認を再実行します。タイムアウト・未確定・通信失敗の場合、時間経過だけでロックを解除しません。
ハッシュがない場合も自動解除・自動再送はしません。画面の開始日時・nonce・開始ブロック・Smart Accountを使い、
管理者とBundler／EntryPointの履歴を調べて結果を特定してください。ハッシュ不明状態を解除する操作はアプリに用意していません。
必要な場合は、チェーン上の証拠を確認した上で別途復旧対応を行います。保存データを削除して再試行する方法は使わないでください。

**制約：ブラウザの保存データの削除、プライベートブラウズの終了、別ブラウザ・端末・別オリジンでは、永続ロックを共有できません。**
保存領域はユーザーが変更できるため、サーバー側の一意性保証ではありません。別端末を含む防止には、別途サーバー側の状態管理が必要です。
BroadcastChannelで他タブへ更新を通知し、フォーカス復帰時にも読み直します。通知失敗時も取得直前のIndexedDB予約で競合を拒否します。

2026-10-26の公開RPC確認では、停止なし・許可リスト無効・取得間隔86,400秒・1回上限3,000,000 JPYC・取得前残高上限1,000,000 JPYCでした。
Pimlicoは既存キーでガス価格取得に成功しましたが、本人のログイン済みSmart Accountでのスポンサー承認と実取得は未確認です。
規約類PDFは調査環境から403となり本文を取得できていないため、利用者自身で公式文書を確認してください。
アプリ上で事前確認が通らない場合は、表示された理由に応じてFaucetの状態・次回取得日時・Pimlicoのポリシーや利用枠を確認してください。

検証：`npx tsc --noEmit`、`npx eslint src/lib/jpycFaucet.ts src/components/JpycFaucet.tsx src/components/JpycPanel.tsx`、`node tests/jpycFaucet.test.mjs`、`node tests/jpycClaimStore.test.mjs`。
テストは制限・スポンサー拒否・シミュレーション拒否・取引失敗・受取ログ欠落時の停止などをモックで検証します。

---

ERC-4337 アカウントアブストラクションを使ったブラウザ内ウォレットのデモアプリです。  
Google アカウントでログインするだけで Smart Account が作成され、Ethereum Sepolia テストネット上でガスレス送金や NFT 閲覧が行えます。

---

## 機能一覧

| カテゴリ | 機能 |
|---|---|
| **認証** | Google OAuth ログイン（Web3Auth） |
| **ウォレット** | ERC-4337 Smart Account の自動生成 |
| **ETH 送金** | 通常送金・Gasless 送金（Pimlico Paymaster） |
| **ERC-20** | 残高表示・複数トークン管理・送金 |
| **ERC-721** | NFT 一覧表示（画像・メタデータ取得） |
| **ERC-1155** | NFT 一覧表示（枚数表示含む） |
| **UI** | ダークモード対応・アコーディオンパネル |
| **UX** | アドレスコピー・Sepolia Etherscan リンク |
| **永続化** | 使用済みコントラクトアドレスを localStorage に記録し、次回ログイン時に自動取得 |

---

## 技術スタック

| 用途 | ライブラリ／サービス |
|---|---|
| フレームワーク | [Next.js](https://nextjs.org/) 16 (App Router) |
| UI | React 19 / Tailwind CSS v4 |
| Ethereum クライアント | [viem](https://viem.sh/) v2 |
| Account Abstraction | [permissionless](https://docs.pimlico.io/permissionless) (ERC-4337) |
| ソーシャルログイン | [Web3Auth Modal](https://web3auth.io/) |
| RPC / NFT API | [Alchemy](https://www.alchemy.com/) (Sepolia) |
| Bundler / Paymaster | [Pimlico](https://www.pimlico.io/) |

---

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd inapp-wallet
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成し、各 API キーを設定します。

```bash
cp .env.example .env.local
```

```env
# Web3Auth — https://dashboard.web3auth.io でプロジェクトを作成
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=your_web3auth_client_id

# Pimlico — https://dashboard.pimlico.io でプロジェクトを作成
NEXT_PUBLIC_PIMLICO_API_KEY=your_pimlico_api_key

# Alchemy — https://dashboard.alchemy.com でプロジェクトを作成
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key

# デフォルトで追跡するコントラクトアドレス（任意）
NEXT_PUBLIC_DEFAULT_ERC20_ADDRESS=0x...
NEXT_PUBLIC_DEFAULT_ERC721_ADDRESS=0x...
NEXT_PUBLIC_DEFAULT_ERC1155_ADDRESS=0x...
```

> **注意:** すべての変数は `NEXT_PUBLIC_` プレフィックスが付いており、ブラウザ側に公開されます。テストネット専用のキーを使用してください。

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

---

## ロゴの設定

`public/logo.png`（または `logo.svg`）にロゴ画像を配置するとヘッダーに表示されます。  
ファイルが存在しない場合はテキスト「FujimuLab」にフォールバックします。

SVG を使う場合は `src/app/page.tsx` の `<img src="/logo.png" ...>` を `<img src="/logo.svg" ...>` に変更してください。

---

## デフォルトコントラクトの設定

`.env.local` に `NEXT_PUBLIC_DEFAULT_ERC721_ADDRESS` などを設定すると、初回ログイン時にそのコントラクトが自動的に追跡対象に追加されます。

```env
NEXT_PUBLIC_DEFAULT_ERC721_ADDRESS=0x29E7216bCB19dF318B60B06dCC824349c3Ea93cE
```

複数のコントラクトを事前登録したい場合は、アプリ内の各パネルから手動で「追加」してください。追加済みのアドレスは localStorage に記録され、次回ログイン時に自動取得されます。

---

## コントラクト履歴の仕組み

各パネル（ERC-20 / ERC-721 / ERC-1155）で使用したコントラクトアドレスは `localStorage` に保存されます。

| 状況 | 動作 |
|---|---|
| ログイン時 | 保存済みアドレスを全件自動フェッチ |
| 残高・保有 NFT が 0 件 | 履歴から自動削除（次回フェッチしない） |
| フェッチエラー | 履歴に残す（一時的な障害の可能性があるため） |
| × ボタン | 手動で履歴から削除 |

---

## アーキテクチャ概要

```
ブラウザ
 ├─ Web3Auth (Google OAuth)
 │    └─ EOA 秘密鍵（デバイスに保存されない）
 │
 ├─ permissionless
 │    ├─ SimpleSmartAccount (ERC-4337)
 │    └─ SmartAccountClient
 │         ├─ Bundler:   Pimlico
 │         └─ Paymaster: Pimlico（ガス代代行）
 │
 ├─ viem / publicClient
 │    └─ Alchemy RPC (Sepolia)
 │
 └─ Alchemy NFT API
      └─ getNFTsForOwner（ERC-721 / ERC-1155 所有トークン取得）
```

### NFT 取得の優先順位（ERC-721）

1. **`tokenOfOwnerByIndex`**（ERC721Enumerable） — `eth_call` のみで完結、高速
2. **Alchemy NFT API** — Enumerable 非対応コントラクトのフォールバック

> Alchemy 無料プランは `eth_getLogs` のブロック範囲が 10 ブロックに制限されているため、イベントログによるスキャンは使用していません。

---

## ディレクトリ構成

```
src/
├── app/
│   ├── layout.tsx          # WalletProvider の配置・フォント設定
│   └── page.tsx            # メインページ・ルーティング
├── components/
│   ├── LoginButton.tsx     # ログイン／ログアウトボタン
│   ├── BalanceCard.tsx     # ETH 残高・アドレス表示
│   ├── SendEth.tsx         # ETH 送金フォーム
│   ├── Erc20Panel.tsx      # ERC-20 トークン管理パネル
│   └── NftPanel.tsx        # ERC-721 / ERC-1155 NFT パネル
├── hooks/
│   └── useWallet.tsx       # ウォレット状態管理（Context）
└── lib/
    ├── web3auth.ts          # Web3Auth 初期化
    ├── smartAccount.ts      # Smart Account / publicClient 生成
    ├── erc20.ts             # ERC-20 ABI・残高取得
    ├── nft.ts               # ERC-721 / ERC-1155 取得（Alchemy NFT API）
    └── contractHistory.ts   # コントラクトアドレス履歴（localStorage）
```

---

## 開発メモ

### テスト用 Sepolia ETH の取得

- [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
- [Infura Sepolia Faucet](https://www.infura.io/faucet/sepolia)

### Web3Auth の注意点

`WEB3AUTH_NETWORK.SAPPHIRE_DEVNET` を使用しています。本番環境では `SAPPHIRE_MAINNET` に変更し、Web3Auth ダッシュボードで本番用クライアント ID を取得してください。

### Gasless 送金について

Pimlico の Paymaster を利用しており、ユーザーはガス代を支払わずに送金できます。Paymaster のスポンサーポリシーは Pimlico ダッシュボードで設定します。
