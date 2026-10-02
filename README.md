# 공모주 레이더

월별 공모주 일정, 근거 기반 분석, 상장 후 성과, 오른쪽 실시간 채팅을 제공하는 정적 웹사이트입니다.

## 실행과 검증

```powershell
npm install
npm run dev
```

http://127.0.0.1:4173 에서 확인합니다. 서버는 공개 화면 파일만 제공하며 `.env`나 SQL 파일은 제공하지 않습니다.

```powershell
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

브라우저 테스트의 예시·채팅은 별도 로컬 모드이므로 실제 Supabase에 테스트 메시지가 등록되지 않습니다.

## 이번 업데이트

- PC: 오른쪽 고정 채팅, 채팅창만 독립 스크롤. 모바일: 본문 아래 채팅.
- 월별 이동, 이름·증권사 검색, 상태·점수 필터, 관심 종목 저장, 공시 원문 링크.
- 실제 데이터가 비어 있어도 가상 기업을 실적으로 표시하지 않습니다. 예시는 별도 버튼으로만 볼 수 있습니다.
- 실시간 채팅, 실제 접속 세션 표시, 재연결, 중복 메시지 처리, 새 메시지 안내. 기존 서버 도배 차단을 유지합니다.
- 2026년 9월 일반 공모주 6개와 스팩 3개의 상장 첫날·상장일 포함 5거래일째 성과. 공모가 배정과 시초가 매수의 수익률을 구분합니다.
- `supabase/updates.sql` 적용 후 신고 접수가 가능합니다. 운영자는 Supabase에서 확인하며 신고 내역은 방문자에게 공개되지 않습니다.

## Supabase와 자동 갱신: 아직 활성화하지 않았습니다

현재 `config.js`의 기존 프로젝트 연결은 유지했습니다. 여기에 사용하는 키는 **Publishable key** 또는 기존 anon key이며, DART 키와 service_role 키는 넣지 않습니다.

신규 프로젝트는 `supabase/schema.sql`, `supabase/rate-limit.sql`, `supabase/updates.sql` 순서로 SQL Editor에서 실행합니다. 기존 프로젝트는 이미 적용한 파일을 다시 실행하지 말고 추가 파일 `updates.sql`만 적용하세요. `chat_messages`의 Realtime publication도 켜져 있어야 합니다.

### API 키를 발급받은 뒤 로컬 수집 확인

`.env.example`을 `.env`로 복사하고 DART_API_KEY만 저장한 다음 실행합니다. 키는 채팅에 보내지 마세요.

```powershell
npm run ipo:sync
```

이 명령은 `data/ipo-import.json`에 수집 결과를 저장하는 로컬 검증입니다. 데이터베이스에 게시하거나 스케줄러를 켜는 명령은 아닙니다. 단순 공시 검토 목록은 `npm run dart:scan`으로 생성합니다.

### 클라우드 자동 갱신 활성화

1. SQL Editor에서 `supabase/updates.sql`을 적용합니다. 기존 공모주와 채팅 데이터는 보존합니다.
2. Edge Function Secrets에 `DART_API_KEY`와 길고 무작위인 `IPO_SYNC_SECRET`을 저장합니다. Supabase 자체의 서버용 URL·service_role은 함수에 자동 주입됩니다.
3. Supabase CLI로 로그인하고 `ipo-sync`를 배포합니다.

```powershell
npx supabase login
npx supabase functions deploy ipo-sync --project-ref YOUR_PROJECT_REF
```

4. Vault에 `gongmo_project_url`(프로젝트 URL), `gongmo_sync_secret`(위 IPO_SYNC_SECRET과 동일)을 저장합니다.
5. SQL Editor에서 `supabase/schedule.sql`을 실행합니다. 한국 시간 00·06·12·18시마다 실행합니다. 청약일 기준으로 월별 분류합니다.
6. 최초 동기화 후 함수 응답과 `ipo_sync_runs` 기록을 확인합니다. API 키 발급 전에는 실제 호출·최초 데이터 검증을 완료할 수 없습니다. 요청이 많아 함수 제한을 넘으면 수집 범위를 분할해야 합니다.

공식 안내: [Supabase 예약 실행](https://supabase.com/docs/guides/functions/schedule-functions), [함수 Secrets](https://supabase.com/docs/guides/functions/secrets).

### 자동 수집 범위와 분석의 한계

OpenDART 공시 목록 전체 페이지, 지분증권 신고서 요약, ZIP 원문을 교차 확인합니다. **이번 공모의 신규·이전상장 근거**, 최신 접수번호, 명확한 청약기일, 일반공모 방식이 모두 확인된 자료만 자동 게시합니다. 유상증자를 IPO로 오인하거나 누락 날짜를 추정하지 않습니다. 불명확한 자료는 검토 대기이며, 정정은 기존 기업 레코드를 갱신하고 철회는 숨깁니다.

공시상 청약기일은 일반 투자자 일정과 다를 수 있습니다. 날짜가 혼합되거나 축약되어 불명확하면 게시하지 않습니다. DART만으로 모든 공모주 일정·상장일·기관 경쟁률·의무보유확약을 보장할 수 없으므로 실제 운영 시 KIND·주관사 공고 대조와 추가 데이터 공급이 필요합니다. 자동 수집에는 가짜 추천 점수를 넣지 않고 **분석 대기**로 표시합니다. 검증된 점수가 등록된 종목만 분석 카드에 노출됩니다.

공식 API: [공시 검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001), [지분증권](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS006&apiId=2020054), [원문 다운로드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019003).

## 2026년 9월 상장 성과

`data/performance-2026-09.js`는 2026-10-02까지 조회한 **고정 스냅샷**이며 시세 자동 갱신은 아직 연결하지 않았습니다. 상장일·공모가는 [KIND 신규상장기업현황](https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain), 일별 OHLC는 네이버 금융을 사용했습니다. 종목별 원문 시세 링크가 화면에 있습니다. `node tools/performance-september.mjs`는 검증용 JSON을 출력합니다.

상장일을 1일째로 계산하고 휴장일은 제외합니다. 5거래일 미만은 기다림으로 표시하고 평균에서 제외합니다. 수익률은 수수료·세금 전입니다. 장중 4배 도달과 종가 4배를 구분하고 과거 가격결정 방식의 ‘따상’과 혼동하지 않도록 설명합니다. 실시간 매매 판단이나 수익 보장이 아닙니다.

## 공개 운영 전

익명 채팅에는 기존 도배 차단 외에도 운영자 관리, CAPTCHA/로그인 등 보강이 필요합니다. 닉네임은 본인 인증이 아닙니다. DART 키·service_role·스케줄러 비밀값은 공개 파일에 포함하지 마세요. 광고 슬롯은 준비된 자리이며 광고 계정 연결과 승인, 개인정보 처리 안내 등은 별도 작업입니다.
