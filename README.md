# openapi-mcp

> ⚠️ **이 저장소는 [`minjun0219/agent-toolkit`](https://github.com/minjun0219/agent-toolkit) 으로 흡수되었습니다 (v0.2 부터).**
> 코어 (deref / swagger 2→3 / conditional GET / 디스크 캐시) 는 그대로,
> tool 표면은 6 → 7 로 살짝 재구성되었습니다 — 기존 `list_specs` /
> `list_environments` / `refresh_spec` 은 `openapi_envs` / `openapi_refresh` 로
> 이름이 바뀌었고 `openapi_status` 가 추가됩니다. agent-toolkit 은 같은
> 라이브러리 위에 (1) Claude Code MCP 진입점, (2) opencode 플러그인, (3) 동일한
> 동작의 `openapi-mcp` 단독 CLI 진입점 (`bin/openapi-mcp`) 을 모두 제공합니다.
> 이 저장소는 곧 archive 됩니다 — 새 사용 / 기여는 agent-toolkit 으로 부탁드립니다.
> 단독 CLI 사용 가이드: [`docs/openapi-mcp.md`](https://github.com/minjun0219/agent-toolkit/blob/main/docs/openapi-mcp.md).
>
> ---

사내 OpenAPI / Swagger 명세를 환경별로 등록해두고, MCP(stdio)로 노출해서
Claude Code · Claude Desktop 같은 MCP host가 자연어로 endpoint를 탐색하고
스펙을 가져갈 수 있게 해주는 CLI 도구.

> 상태: v1 (alpha). HTTP transport / 인증 / 실제 API 호출 / 코드 생성은
> 의도적으로 범위 밖. 자세한 내용은 [CLAUDE.md](./CLAUDE.md) 참고.

## 설치 & 빌드

요구 사항: **Node.js 22 이상**.

```bash
git clone <repo>
cd openapi-mcp
npm install
npm run build
```

빌드된 CLI는 `./dist/index.js` 입니다 (`#!/usr/bin/env node` shebang 포함).

```bash
node ./dist/index.js --help
```

> v1은 npm registry에 publish 하지 않습니다. 사내 사용은 git clone 후
> `node dist/index.js` 또는 `npm link` 로 호출하세요.

## 설정 파일

기본 경로는 `~/.config/openapi-mcp/openapi-mcp.json` (XDG `$XDG_CONFIG_HOME`
존중). `--config <path>` 로 위치를 바꿀 수 있고, 확장자에 따라 JSON / YAML /
YML 어느 것이든 받습니다.

최소 형태:

```json
{
  "specs": {
    "payment": {
      "source": {
        "type": "url",
        "url": "https://swagger.dev.internal/payment/v3/api-docs"
      },
      "environments": {
        "dev": { "baseUrl": "https://api.dev.internal/payment" },
        "stage": { "baseUrl": "https://api.stage.internal/payment" }
      }
    }
  }
}
```

전체 옵션: [`examples/config.example.yaml`](./examples/config.example.yaml),
[`examples/config.example.json`](./examples/config.example.json).

핵심 필드:

| 필드 | 설명 |
| ---- | ---- |
| `specs.<name>.source` | `{ type: 'url', url }` 또는 `{ type: 'file', path }`. **상대경로는 config 파일 디렉토리 기준**으로 해석됩니다 (CWD 아님). `format` 으로 `openapi3` / `swagger2` / `auto` 중 강제 가능 (기본 `auto`). |
| `specs.<name>.environments.<env>.baseUrl` | 실제 API base URL. `get_endpoint` 가 path 와 합성해 `fullUrl` 로 응답. |
| `specs.<name>.environments.<env>.source` | 환경별 spec source override (옵션). |
| `specs.<name>.cacheTtlSeconds` | 백그라운드 재검증 주기 (기본 300초). |
| `cache.diskCache` | 디스크 캐시 on/off (기본 `true`). |
| `cache.diskCachePath` | 디스크 캐시 디렉토리 (기본 `~/.cache/openapi-mcp`). |
| `http.timeoutMs` | HTTP fetch 타임아웃 (기본 10000ms). |
| `http.insecureTls` | TLS 검증 비활성화. CLI `--insecure-tls` 와 동일. |

## CLI

```text
openapi-mcp [options]

Options:
  -c, --config <path>      설정 파일 경로 (기본: ~/.config/openapi-mcp/openapi-mcp.json)
  -l, --log-level <level>  로그 레벨 trace|debug|info|warn|error|fatal|silent (기본 info)
  --insecure-tls           TLS 인증서 검증 비활성화 (사내 self-signed 환경)
  -V, --version            버전 출력
  -h, --help               도움말
```

stdio transport 이므로 stdout 은 JSON-RPC 전용입니다. 모든 로그는
**stderr** 로 나갑니다 (pino).

self-signed 인증서 환경에서는 다음 둘 중 하나:

- `openapi-mcp --insecure-tls --config ...`
- `NODE_EXTRA_CA_CERTS=/path/to/ca.pem openapi-mcp --config ...`

## MCP host 에 연결하기

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) 또는 `%APPDATA%/Claude/claude_desktop_config.json` (Windows) 에:

```json
{
  "mcpServers": {
    "openapi": {
      "command": "node",
      "args": [
        "/absolute/path/to/openapi-mcp/dist/index.js",
        "--config",
        "/absolute/path/to/openapi-mcp.json"
      ]
    }
  }
}
```

### Claude Code (VS Code / CLI)

`.mcp.json` 또는 `~/.claude/mcp.json` 에 동일하게 등록합니다. 자세한 설정
경로는 Claude Code 공식 문서를 참고하세요.

### MCP Inspector 로 직접 디버깅

```bash
npx @modelcontextprotocol/inspector node dist/index.js --config /path/to/config.json
```

브라우저에서 tool 목록과 응답을 확인할 수 있습니다.

## 노출되는 MCP tools

| Tool | 입력 | 결과 |
| ---- | ---- | ---- |
| `list_specs` | 없음 | 등록된 spec, environment, 캐시 상태 |
| `list_environments` | `spec` | spec 의 환경 목록과 baseUrl |
| `list_tags` | `spec` | OpenAPI tag 목록 + endpoint 개수 |
| `list_endpoints` | `spec?`, `tag?`, `method?`, `keyword?`, `limit?` | 요약된 endpoint 리스트. 키워드는 operationId > path > summary > description 순으로 점수화. |
| `get_endpoint` | `spec`, `environment`, (`operationId` 또는 `method`+`path`) | 파라미터·요청·응답·예제·`fullUrl` 포함한 상세 |
| `refresh_spec` | `spec?` | 캐시 강제 갱신 (없으면 모든 spec) |

전형적인 흐름: `list_specs` → `list_endpoints` (필터) → `get_endpoint`.

## 캐싱 동작

- 첫 요청 시 spec 을 fetch + parse + dereference + index 후 in-memory 캐시.
- 디스크 캐시(기본 활성)에도 동시에 저장. 다음 프로세스 시작 시 hydrate.
- TTL (`cacheTtlSeconds`) 이 지나면 다음 요청은 stale 데이터로 즉시
  응답하고, 백그라운드에서 conditional GET (`If-None-Match`,
  `If-Modified-Since`) 으로 재검증.
- 재검증 실패 시 stale 캐시 유지하고 stderr 에 경고 로그.
- `refresh_spec` 은 캐시(메모리·디스크) 를 모두 비우고 무조건적으로 재다운로드.

## 개발

```bash
npm test               # vitest 단위 테스트 (51 tests)
npm run typecheck      # tsc --noEmit
npm run build          # dist/ 빌드
```

테스트 fixtures: `tests/fixtures/petstore-3.0.json`,
`petstore-3.0.yaml`, `petstore-2.0.json`. 사내 spec 으로 교체하려면
같은 디렉토리에 추가하고 `tests/fixtures/multi-spec-config.json` 을 수정하세요.

세부 아키텍처와 절대 어기지 말 것 목록은 [CLAUDE.md](./CLAUDE.md).
