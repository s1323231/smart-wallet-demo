# シンプルなイベント参加特典

現在は先生のウォレット画面に、入力・確認・完了を試す参加登録の画面プレビューを追加しています。以下の実配布フローはまだ参加登録フォームに接続していません。
実配布へ進める際は、既存ウォレット画面を保ち、参加登録フォームからログイン済みウォレットの `EventCheckIn` へ接続します。

Googleログイン → 参加登録 → テスト用1 JPYCと参加証NFTを受取、の1イベント専用アプリです。
先生のWeb3Auth・ERC-4337 Smart Account・Pimlicoの仕組みを利用します。
参加者が送金先や金額を入力する必要はありません。

## 主催者の初回設定

1. `npm install` を実行します。
2. Sepolia専用の主催者アカウントを用意し、配置手数料用のテストETHを入れます。
3. `.env.local` に既存のWeb3Auth・Alchemy・Pimlicoの設定を入れます。
   配置時だけ `EVENT_DEPLOYER_PRIVATE_KEY=0x...` も設定します。
   このキーには `NEXT_PUBLIC_` を付けず、公開・コミットしないでください。
4. `npm run event:compile` と `npm run event:test` でコントラクトを確認します。
5. `npm run event:deploy` を実行します。この操作でSepoliaへ配置され、主催者のテストETHを消費します。
6. 表示された `NEXT_PUBLIC_EVENT_REWARDS_ADDRESS=0x...` を `.env.local` に追記します。
7. そのアドレスへ、公式Sepoliaテスト用JPYC
   `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` を送ります。
   1人につき1 JPYC必要です。参加者ごとのFaucet利用は不要です。
8. Pimlicoのスポンサー設定で、今回配置したEventRewardsへの `register()` を許可します。
   スポンサー承認が得られなければ、アプリは送信しません。
9. `npm run dev` を起動し、実際のGoogleアカウントで登録・受取・再読み込み後の表示を確認します。
   配置後は配置用秘密鍵を `.env.local` から外せます。日常の配布には不要です。
10. 公開したアプリのトップページURLを会場のQRコードにします。
    localhostのURLは来場者のスマートフォンから利用できません。
    Web3Authにも公開URLを登録してください。

未設定のときは「主催者が準備中」と表示します。架空のポイントやNFTを受取済みとして表示するモック動作はありません。
このリポジトリの実装だけでは、実ネットワークへの配置・資金補充・スポンサー設定は完了しません。

## 配布の仕組み

`contracts/EventRewards.sol` はERC-721の参加証でもあり、JPYCの配布元でもあります。
事前に入れたJPYCから、呼び出したウォレット自身へ1 JPYCを送り、参加証を発行します。
同じトランザクションで実行するので、JPYC不足などで失敗すると登録・NFTも取り消されます。
主催者の署名サーバーや秘密鍵をアプリに組み込む必要はありません。
この最小デモには残余JPYCの引出機能はありません。必要人数分を少量ずつ補充してください。
NFTの画像とメタデータはコントラクト内に保存され、外部画像ホスティングは不要です。

NFTは所有者自身の署名で通常のERC-721として移転可能です。画面の参加証は元の登録記録を表示します。
ポイント欄は受取実績と現在のJPYC残高を区別しています。

## 重複防止と研究の範囲

- 重複配布はチェーン上のウォレット別記録で防ぎます。別端末や別タブからも二重配布されません。
- 1人が複数のGoogleアカウントやウォレットを使うことは防ぎません。
- 公開URL・コントラクトを知っていれば会場外からも登録できます。QRコードだけでは来場を証明できません。
- このデモのNFTは「イベント参加登録の証明」です。厳密な入場確認は将来の課題です。
- 処理が未確認の場合、自動再送や受取成功の表示はしません。「受取状況を確認」は照会のみです。
  チェーンで重複配布は防げますが、重複送信によるスポンサー手数料の発生まで完全には防ぎません。
- 初期エラーでもその画面で再送を止める保守的な動作です。主催者はUserOperationと登録記録を確認します。
- 本物のお金・商品との交換、複数イベント、店舗決済は対象外です。

## 動作確認

`npm run event:test` はローカルEVM上でSolidityをコンパイルし、JPYC不足時の全取消、
JPYCとNFTの同時受取、二重登録の拒否、トークンがfalseを返す場合の全取消、別参加者の登録、NFT受取用フックを持たないコントラクトウォレットでの受取を確認します。
クライアント側でもスポンサー拒否・ネットワーク不一致・取引失敗時に成功扱いしないことを確認します。
`npx tsc --noEmit` と `npx eslint src/app/page.tsx src/app/layout.tsx src/components/EventCheckIn.tsx src/lib/eventRewards.ts scripts/*.mjs tests/eventRewards*.test.mjs` でアプリを確認します。
実際のWeb3Auth・Pimlico・公式JPYCでの確認は、上記の主催者設定後に別途必要です。

参考：ERC-721とERC-20送金はOpenZeppelin Contracts 5.4.0を使用します。
[ERC-721](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721)、
[SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20)。
