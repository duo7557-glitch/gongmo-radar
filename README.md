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
- 월별 캘린더를 리스트/달력 두 가지 보기로 전환할 수 있습니다(`#viewSwitch`). 달력 칸에는 해당 날짜에 청약 중인 종목이 작은 태그로 표시되고, 클릭하면 기존 상세 모달이 열립니다. 선택한 보기는 브라우저에 저장됩니다.
- OpenDART 자동 수집은 **GitHub Actions**에서 하루 4번(한국시간 00·06·12·18시) 실행됩니다. Supabase Edge Function(`ipo-sync`)은 TLS 1.2까지만 지원하는 OpenDART 서버와 Deno 런타임의 호환 문제로 접속이 거부되어(`받은 fatal alert: HandshakeFailure`), 실제 수집은 Node.js 환경(GitHub Actions)에서 수행하고 Supabase는 데이터베이스 역할만 합니다. 관련 pg_cron 스케줄은 꺼두었습니다.

## Supabase와 자동 갱신

현재 `config.js`의 기존 프로젝트 연결은 유지했습니다. 여기에 사용하는 키는 **Publishable key** 또는 기존 anon key이며, DART 키와 service_role 키는 넣지 않습니다.

신규 프로젝트는 `supabase/schema.sql`, `supabase/rate-limit.sql`, `supabase/updates.sql` 순서로 SQL Editor에서 실행합니다. 기존 프로젝트는 이미 적용한 파일을 다시 실행하지 말고 추가 파일 `updates.sql`만 적용하세요. `chat_messages`의 Realtime publication도 켜져 있어야 합니다.

### API 키를 발급받은 뒤 로컬 수집 확인

`.env.example`을 `.env`로 복사하고 DART_API_KEY만 저장한 다음 실행합니다. 키는 채팅에 보내지 마세요.

```powershell
npm run ipo:sync
```

이 명령은 `data/ipo-import.json`에 수집 결과를 저장하는 로컬 검증입니다. 데이터베이스에 게시하거나 스케줄러를 켜는 명령은 아닙니다. 단순 공시 검토 목록은 `npm run dart:scan`으로 생성합니다.

### 클라우드 자동 갱신 활성화 (GitHub Actions)

1. SQL Editor에서 `supabase/updates.sql`을 적용합니다(`claim_ipo_sync` 잠금 함수, `ipo_sync_runs` 기록 테이블 포함).
2. GitHub 저장소 Settings → Secrets and variables → Actions에 `DART_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`를 등록합니다. `.github/workflows/ipo-sync.yml`이 하루 4번(UTC 03/09/15/21시 = 한국시간 12/18/00/06시) `tools/publish-ipo.mjs`를 실행해 Supabase REST API로 직접 upsert합니다.
3. 수동 실행/과거 구간 백필은 `workflow_dispatch` 입력값(`begin`, `end`, YYYYMMDD)으로 가능합니다. OpenDART 목록 조회는 한 번에 최대 3개월(약 85일)이라 더 긴 구간은 나눠서 실행해야 합니다.

```powershell
gh workflow run ipo-sync.yml --repo <owner>/<repo>                              # 최근 85일
gh workflow run ipo-sync.yml --repo <owner>/<repo> -f begin=20260101 -f end=20260326  # 과거 구간 백필
```

4. 실행 기록은 저장소의 **Actions** 탭과 Supabase `ipo_sync_runs` 테이블에서 확인합니다.

과거 구간(특히 올해 초처럼 이미 상장이 끝난 달)은 공시 요약 API의 접수번호가 최신 정정신고서와 정확히 맞아떨어지지 않는 경우가 많아, 신규 등록 없이 대부분 **검토 대기**로만 쌓일 수 있습니다. 틀린 정보를 올리지 않기 위한 의도된 동작입니다.

공식 안내: [Supabase 예약 실행](https://supabase.com/docs/guides/functions/schedule-functions), [함수 Secrets](https://supabase.com/docs/guides/functions/secrets). (Edge Function `ipo-sync`는 코드가 남아 있지만 위 TLS 문제로 스케줄에서는 더 이상 호출하지 않습니다.)

### 자동 수집 범위와 분석의 한계

OpenDART 공시 목록 전체 페이지, 지분증권 신고서 요약, ZIP 원문을 교차 확인합니다. **이번 공모의 신규·이전상장 근거**, 최신 접수번호, 명확한 청약기일, 일반공모 방식이 모두 확인된 자료만 자동 게시합니다. 유상증자를 IPO로 오인하거나 누락 날짜를 추정하지 않습니다. 불명확한 자료는 검토 대기이며, 정정은 기존 기업 레코드를 갱신하고 철회는 숨깁니다.

공시상 청약기일은 일반 투자자 일정과 다를 수 있습니다. 날짜가 혼합되거나 축약되어 불명확하면 게시하지 않습니다. DART만으로 모든 공모주 일정·상장일·기관 경쟁률·의무보유확약을 보장할 수 없으므로 실제 운영 시 KIND·주관사 공고 대조와 추가 데이터 공급이 필요합니다. 자동 수집에는 가짜 추천 점수를 넣지 않고 **분석 대기**로 표시합니다. 검증된 점수가 등록된 종목만 분석 카드에 노출됩니다.

공식 API: [공시 검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001), [지분증권](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS006&apiId=2020054), [원문 다운로드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019003).

#### DART 매칭 규칙 (실제 상장 종목과 대조해 확인한 것)

- 지분증권 요약 API(estkRs)는 마지막 `증권신고서`(정정 포함)만 반영하고 `[발행조건확정]`·투자설명서·실적보고서·철회신고서는 반영하지 않는다. 그래서 "최신 공시"가 아니라 **요약이 가리키는 신고서**를 공시 이력에서 찾아 맞춘다.
- 확정 공모가는 `[발행조건확정]` 정정표의 "정정 후 모집(매출)가액"에서 읽는다. 없으면 희망가 밴드로 표시한다(estkRs의 `slprc`는 밴드 최저가라 공모가로 쓰지 않는다).
- 외국 기업은 증권예탁증권(DR, 공시유형 C005, 요약 API `stkdpRs`)으로 상장한다.
- 이미 상장한 종목은 KIND 신규상장(공모) 목록의 종목코드로 공모주임을 확인한다. 상장사 유상증자 신고서는 예전 상장 당시의 "상장주선인" 표현을 쓰므로 그 문구만으로는 공모주로 보지 않는다.
- `node tools/verify-calendar.mjs`: KIND 실제 상장 종목을 정답으로 놓고 캘린더(청약일·확정 공모가)를 대조한다.

## 상장주 시세·수익률 TOP 10 (매일 자동 갱신)

`tools/price-history.mjs`가 KIND에서 올해 공모 신규·이전상장 종목을, 네이버 금융에서 상장일~최신 거래일 시세를 받아 `data/price-history-YYYY.js`와 Supabase `ipo_price_history`(공개 읽기, `supabase/price-history.sql`)에 저장한다. 외국 기업은 KIND가 발행사 코드(예: `USA28`)를 주므로 네이버 종목 검색으로 코드를 찾는다. `.github/workflows/price-history.yml`이 평일 16:30·19:30(KST)에 실행하며, 사이트는 정적 파일로 먼저 그린 뒤 DB에 더 최신 시세가 있으면 TOP 10과 상장 후 성과 그래프를 다시 그린다. 수동 실행: `npm run price:history`.

## 핫한 공모주·상세 체크리스트

- 🔥 HOT: 자동 분석 80점 이상, 기관 수요예측 1,000:1 이상, 확정 공모가가 희망가 상단 초과 중 하나라도 해당(배지 툴팁에 근거 표시). 수요예측 결과는 `[발행조건확정]` 공시에만 실리므로 자동 점수는 그 원문을 읽는다.
- 상세 창 핵심 체크리스트: 공모가 위치, 수요예측 경쟁률, 의무보유확약, 유통가능물량, 공모주식수·공모금액, 구주매출 비중, 상장일 가격 범위(공모가 60~400%), 비용 포함 손익분기 계산기. 공시로 확인되지 않은 값은 "확인 불가"로 둔다.

## 월별 상장 성과

월별 데이터 파일은 오프라인 대체 자료입니다. 최신 시세가 들어오면 상장 월별 성과를 자동 계산해 갱신합니다. 상장일·공모가는 [KIND 신규상장기업현황](https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain), 일별 OHLC는 네이버 금융을 사용합니다. 종목별 원문 시세 링크가 화면에 있습니다.

상장일을 1일째로 계산하고 휴장일은 제외합니다. 5거래일 미만은 기다림으로 표시하고 평균에서 제외합니다. 수익률은 수수료·세금 전입니다. 장중 4배 도달과 종가 4배를 구분하고 과거 가격결정 방식의 ‘따상’과 혼동하지 않도록 설명합니다. 실시간 매매 판단이나 수익 보장이 아닙니다.

## 공개 운영 체크

- `supabase/ops-readiness.sql`을 기존 테이블 생성 이후 Supabase SQL Editor에서 한 번 실행합니다. 서비스 상태 표시는 마지막 공시 수집 시각과 성공·검토·실패만 공개하며, 수집 상세나 비밀값은 노출하지 않습니다. 12시간 이상 새 기록이 없으면 갱신 지연으로 표시합니다.
- `.github/workflows/ops-alert.yml`은 `IPO sync` 또는 `Price history` 작업이 실패하면 저장소 Issues에 운영 알림을 열고, 다음 성공 실행에서 자동으로 닫습니다. Issues 알림을 받으려면 GitHub에서 저장소 알림을 켜 두세요.
- 신고 검토는 Supabase SQL Editor에서 `select * from public.chat_moderation_queue order by report_count desc, last_reported_at desc;`로 확인합니다. 숨김은 `update public.chat_messages set moderation_status = 'hidden' where id = <메시지 ID>;`, 복구는 `'visible'`로 바꿉니다. 이 권한은 공개 방문자에게 주지 않습니다.
- 월별 상장 성과는 상장일·공모가와 시세 이력에서 자동 묶습니다. 평일 갱신된 Supabase 시세가 정적 사본보다 최신이면 배포 없이 업데이트하며, 연결이 안 되면 기존 스냅샷을 계속 보여줍니다. 시세 누락 종목이 있는 달은 불완전 자료로 덮어쓰지 않습니다.
- 공개 채팅은 익명이며 닉네임이 본인 확인을 뜻하지 않습니다. 신고함을 주기적으로 검토하고, 대응이 어려운 기간에는 채팅을 잠시 닫는 것을 권합니다.
- 제3자 방문 분석은 추가하지 않았습니다. 방문 통계를 도입하려면 사용할 분석 서비스와 개인정보 안내 범위를 먼저 정해야 합니다. 광고 문구와 슬롯은 현재 공개 화면에서 제외했습니다.

DART 키·service_role·스케줄러 비밀값은 공개 파일에 포함하지 마세요.
