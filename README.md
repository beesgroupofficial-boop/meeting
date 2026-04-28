# 売上管理アプリ セットアップガイド

## 完成イメージ
- URL: `https://あなたのGitHubユーザー名.github.io/sales-app/`
- スマホのホーム画面に追加してアプリとして使える
- 複数人がリアルタイムでデータを共有

---

## STEP 1: Firebaseの設定（約10分）

### 1-1. Firebaseプロジェクト作成
1. [https://console.firebase.google.com](https://console.firebase.google.com) を開く
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `sales-management`）
4. Google アナリティクスは「無効」でOK → 「プロジェクトを作成」

### 1-2. Firestoreデータベース作成
1. 左メニュー「Firestore Database」をクリック
2. 「データベースの作成」
3. **本番環境モード**を選択
4. リージョンは「asia-northeast1（東京）」を選択 → 「有効にする」

### 1-3. セキュリティルールを設定
Firestore → 「ルール」タブ を開いて以下に変更（コピー&ペースト）:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

「公開」ボタンをクリック。

> ⚠️ 注意: 上記は簡易設定です。第三者に知られたくない場合は認証設定を追加してください。

### 1-4. アプリの設定情報を取得
1. プロジェクトの「⚙️ 設定」→「プロジェクトの設定」
2. 「マイアプリ」→「</>」（ウェブ）アイコンをクリック
3. アプリ名を入力（例: `sales-web`）→「アプリを登録」
4. 「Firebase SDK の追加」に表示される `firebaseConfig` の内容をコピー

### 1-5. firebase-config.js を編集
`js/firebase-config.js` を開き、`YOUR_...` の部分を実際の値に書き換え:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",          // ← コピーした値に変更
  authDomain: "xxx.firebaseapp.com",
  projectId: "xxx",
  storageBucket: "xxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

---

## STEP 2: GitHubにアップロード（約5分）

### 2-1. リポジトリ作成
1. [https://github.com/new](https://github.com/new) を開く
2. Repository name: `sales-app`
3. **Public** を選択（GitHub Pages無料利用のため）
4. 「Create repository」

### 2-2. ファイルをアップロード
ターミナル（Mac）またはコマンドプロンプト（Windows）で:

```bash
# このフォルダに移動
cd sales-app

# Gitを初期化してアップロード
git init
git add .
git commit -m "初回コミット"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/sales-app.git
git push -u origin main
```

Gitがない場合は GitHub Desktop を使うか、GitHub のウェブ画面から「Upload files」でフォルダごとドラッグ&ドロップ。

### 2-3. GitHub Pages を有効化
1. GitHubのリポジトリページ → 「Settings」タブ
2. 左メニュー「Pages」
3. Source: **GitHub Actions** を選択
4. 数分待つと Actions が実行され、URLが表示される

---

## STEP 3: スマホにインストール（iPhone）

1. Safariで `https://あなたのユーザー名.github.io/sales-app/` を開く
2. 画面下の「共有」ボタン（四角に矢印）をタップ
3. 「ホーム画面に追加」をタップ
4. 「追加」→ ホーム画面にアプリアイコンが出現！

---

## STEP 4: アプリの使い方

### 毎日の操作
1. アプリを開く
2. カレンダーで今日の日付をタップ
3. 店舗タブを切り替えながら売上を入力
4. 「保存する」をタップ

### 月間目標の設定
- 右上の「◎」ボタンから月間目標売上とイベント内容を設定

### Excelで出力
- 右上の「📄」ボタン → Claudeのチャットに戻りExcelが生成される

---

## よくある質問

**Q: 複数人で使うには？**
A: 同じURLを共有するだけで、全員が同じFirestoreにアクセスします。リアルタイムで同期されます。

**Q: データはどこに保存？**
A: Googleのサーバー（Firebase Firestore）に保存されます。

**Q: 無料で使える？**
A: Firebase無料枠（1日50,000読み取り/20,000書き込み）とGitHub Pages（無料）で十分です。

**Q: アプリのURLを変えたい**
A: GitHub の Settings → Pages → Custom domain にドメインを入力できます。

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 白い画面 | firebase-config.js の設定値を確認 |
| データが保存されない | Firestoreのルールを確認 |
| GitHub Pages が表示されない | Actions タブでエラーを確認 |
| iPhoneでインストールできない | Safariで開いているか確認（Chromeは不可） |
