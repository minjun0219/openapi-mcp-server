# openapi-mcp

사내 OpenAPI/Swagger 스펙을 MCP(stdio)로 노출해 Claude가 자연어로 endpoint를 탐색·조회하도록 돕는 CLI 도구.

## Stack

- Node.js >= 22 (LTS)
- TypeScript (NodeNext, ESM)
- `@modelcontextprotocol/sdk` (stdio transport)
- `@apidevtools/swagger-parser` (OpenAPI 3 파싱·dereference)
- `swagger2openapi` (Swagger 2.0 → OpenAPI 3.0 변환)
- `undici` (HTTP fetch, conditional GET)
- `zod` (tool input schema)
- `commander` (CLI)
- `pino` (구조화 로깅, **stderr 전용**)
- `vitest` (테스트)

## Layout

```
src/
  index.ts              CLI entry (#!/usr/bin/env node)
  server.ts             MCP server bootstrap
  config/               설정 파일 schema/loader
  spec/                 fetcher, parser, indexer, registry
  cache/                memory + (optional) disk
  tools/                6개 MCP tool 핸들러
  search/               키워드 필터
  util/                 logger, url 합성
tests/                  vitest + fixtures
examples/               예시 config
```

## Commands

- `npm run build` — `tsc -p tsconfig.build.json`
- `npm run dev` — watch 빌드
- `npm test` — vitest 단위 테스트
- `npm run lint` — eslint
- `npm run typecheck` — `tsc --noEmit`
- `npm start` — `node dist/index.js` (빌드 후)

## 절대 어기지 말 것

- **stdout 로그 금지**. stdio MCP는 stdout이 JSON-RPC 전용. 모든 로그는 pino → stderr.
  `console.log` 절대 사용 금지. `console.error`도 가급적 logger 우회.
- **데이터 모델 필드명 임의 변경 금지**. 핸드오프 명세의 인터페이스(`OpenApiMcpConfig`,
  `IndexedEndpoint`, `EndpointDetail` 등) 필드는 추가만 허용, 이름 변경/삭제 금지.
- **신규 dependency 임의 추가 금지**. 핸드오프 명세 외 라이브러리가 필요하면 사용자에게 질문.
- **v1 OUT OF SCOPE 항목 임의 구현 금지**: HTTP transport, Docker, 인증, 시맨틱 검색,
  실제 API 호출, 예제 코드 생성, spec validation 보고서, multi-tenant.

## 작업 시 주의

- stdio transport이므로 디버깅은 stderr 로그(`--log-level debug`) 의존.
- MCP Inspector(`npx @modelcontextprotocol/inspector node dist/index.js --config <path>`)로
  수동 검증 권장.
- 설정 파일 경로 우선순위: `--config <path>` CLI 인자 > 기본
  `~/.config/openapi-mcp/openapi-mcp.json`. env / CWD fallback 없음.
- 설정 파일 포맷은 확장자로 자동 감지 (`.json` / `.yaml` / `.yml`).
- TLS self-signed 환경: `--insecure-tls` 옵션 또는 `NODE_EXTRA_CA_CERTS` 환경변수.

## 결정 기록

- 패키지 이름: `openapi-mcp` (placeholder, v1 publish 안 함)
- npm publish: v1 보류. publishConfig 미설정.
- 설정 경로: CLI `--config <path>` 만.
- Swagger 2.0 fixture: Petstore 2.0 사용. 추후 사내 spec으로 교체.
