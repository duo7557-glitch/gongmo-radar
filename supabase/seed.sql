-- 테스트 후 실제 공시 원문을 검증한 데이터만 is_published = true로 바꾸세요.
insert into public.ipo_listings
  (name, sector, subscription_start, subscription_end, price_text, broker, score, reason, tags, status, is_published)
values
  ('샘플 기업', '예시 업종', '2026-10-13', '2026-10-14', '10,000 ~ 12,000원', '샘플증권', 75, '실제 공시 확인 전에는 공개하지 마세요.', array['샘플', '공시 확인'], '예정', false);
