# BibleCharacter.AI — Vercel 배포 가이드

## 파일 구조
```
biblecharacter-vercel/
├── index.html      ← 메인 앱
├── api/
│   └── chat.js    ← Anthropic API 프록시 (API 키 보관)
├── vercel.json     ← Vercel 설정
└── README.md
```

## 배포 순서

### 1. Vercel 계정 준비
- vercel.com 로그인 (GitHub 계정 연동 추천)

### 2. 프로젝트 업로드
방법 A — Vercel CLI (터미널):
```bash
npm i -g vercel
cd biblecharacter-vercel
vercel
```

방법 B — 드래그앤드롭 (더 쉬움):
- vercel.com/new 접속
- 이 폴더 전체를 드래그해서 업로드

### 3. 환경변수 설정 (핵심!)
Vercel 대시보드 → 프로젝트 → Settings → Environment Variables
```
Key:   ANTHROPIC_API_KEY
Value: sk-ant-api03-xxxxx (본인 API 키)
```

### 4. 배포 완료
→ https://biblecharacter-ai.vercel.app 접속 가능

## 무료 5회 제한
- localStorage 기반 (월별 초기화)
- 5회 초과 시 업그레이드 안내 모달 표시

## 비용
- Vercel: 무료 플랜으로 충분
- Anthropic API: 사용량에 따라 과금 (5회 × 성도수)
