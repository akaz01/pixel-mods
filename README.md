# pixel-mods

Claude Code용 mod 네 개를 모아 둔 비공개 저장소입니다. 픽셀 아트 스타일의 작업 보드(work-board)와, 보드가 읽어 가는 세 가지 보조 mod(agent-router, collab-hub, safe-shell)로 이루어져 있습니다. 각 mod는 독립된 플러그인 폴더이며, work-board는 나머지 세 mod를 의존성으로 선언합니다.

## Mods

### work-board

화면 오른쪽에 붙는 pixel board pane입니다. 맨 위에 노란 title band가 있습니다.

- hero row: 왼쪽 text column(ANTHROPIC CLAUDE / MODEL / plan badge / WEEK, 5HR limits), 픽셀 Claude sprite, 현재 상태를 말하는 pixel speech bubble. 상태 단어는 THINKING, CODING, RUNNING, TESTING, WRAPPING, DONE, READY, SLEEPING 등입니다.
- Ultra처럼 5시간 limit이 없는 plan에서는 5HR 줄 대신 week gauge를 보여 줍니다.
- STATUS window: RAM, CONTEXT 게이지(색은 초록, 노랑, 빨강 순). CONTEXT 줄에서 COMPACT 버튼을 쓸 수 있습니다.
- tabs: RUNNING, ROUTING, COLLAB, TIMELINE, USAGE, 그리고 명령 안내 `?` 탭.
- 요청과 tool step의 timeline, 건드린 files, 주간/5시간 사용량 기록을 보여 줍니다.

### agent-router

subagent를 만들 때 모델을 정해 주는 mod입니다.

- type별 규칙(`rules.json`)과 작업 level(L1-L3)로 haiku, sonnet, opus 중 하나를 고릅니다. fork와 workflow는 건드리지 않습니다.
- 동시 실행 한도(기본 concurrent 4, background 2)를 넘으면 spawn을 막습니다. 한도는 routing이 꺼져 있어도 적용됩니다.
- 메인 스레드에는 모델을 바꾸지 않고 `/model` 힌트만 toast로 알려 줍니다.

### collab-hub

같은 PC에서 돌아가는 세션끼리 쓰는 공유 보드입니다. 파일은 `~/.claude/collab-hub/` 아래에 둡니다.

- 60초마다 heartbeat를 남기고 30초마다 다른 세션과 notice를 읽습니다.
- `/claim`한 파일을 다른 세션이 Edit/Write하려 하면 막고, 먼저 물어보거나 `/release`를 기다리라고 안내합니다.
- notice는 모든 세션에 toast로 뜹니다(24시간 보관).
- `[hub]` 메시지(REQUEST 등)를 thread로 묶어 세션 사이 요청과 답을 이어 줍니다.

### safe-shell

Bash와 PowerShell 명령을 실행 전에 검사하는 3단계 guard입니다.

- CAUTION: toast로 알리고 실행합니다.
- DANGER: 막고 더 안전한 대안을 알려 줍니다. `/allow-once`로 위험한 한 단계만 한 번 통과시킬 수 있습니다(5분 안에 쓰지 않으면 만료).
- FORBIDDEN: 항상 막습니다.
- `/safe-shell`이 level 규칙과 이번 세션의 횟수(caution, danger, forbidden)를 보여 줍니다.

## Commands

| Command | 설명 |
| --- | --- |
| `/board` | Work Board를 열거나 닫습니다(토글). |
| `/board close` | 보드를 닫습니다. |
| `/board help` | 명령 안내 탭(`?`)을 엽니다. |
| `/board clear` | timeline과 files 목록을 비웁니다. |
| `/board 5h on\|off` | 5시간 limit 줄을 보이거나 숨깁니다. |
| `/board-clear` | `/board clear`와 같습니다. |
| `/board-5h-on` | `/board 5h on`과 같습니다. |
| `/board-5h-off` | `/board 5h off`와 같습니다. |
| `/routing` | 라우팅 요약(스위치 상태, 모델별 횟수, 최근 결정)을 보여 줍니다. |
| `/routing on\|off` | 라우팅 전체를 켜거나 끕니다. |
| `/routing level on\|off` | 작업 level(L1-L3) 기준 라우팅을 켜거나 끕니다. |
| `/routing hints on\|off` | 메인 스레드 모델 힌트를 켜거나 끕니다. |
| `/routing rules` | `rules.json`을 다시 읽고 type별 규칙을 보여 줍니다. |
| `/collab` | 세션 보드를 보여 줍니다. |
| `/collab name <name>` | 이 세션의 이름을 바꿉니다. |
| `/collab <session> <task>` | 다른 세션에 `[hub]` REQUEST를 보냅니다. |
| `/notice <text>` | 이 PC의 모든 세션에 notice를 올립니다. |
| `/claim <file>` | 파일을 이 세션이 편집 중이라고 표시합니다. |
| `/release <file>\|all` | claim을 풀거나 전부 풉니다. |
| `/allow-once [off]` | 다음 DANGER 명령 하나를 한 번 통과시킵니다. `off`는 취소합니다. |
| `/safe-shell` | safe-shell level 규칙과 이번 세션 횟수를 보여 줍니다. |

## 설치

work-board는 나머지 세 mod를 함께 쓰므로 네 개를 모두 설치합니다. 설치한 뒤 새로 여는 Claude 세션부터 켜집니다.

### 준비

이 저장소는 비공개입니다. 설치할 컴퓨터에서 이 저장소에 접근할 수 있는 GitHub 계정으로 먼저 로그인합니다.

```
gh auth login
```

### 방법 1. 터미널 명령 (추천)

PowerShell이나 터미널에서 아래 줄을 차례로 실행합니다. `--scope user`는 모든 폴더에서 쓰는 설치입니다.

```
claude plugin marketplace add akaz01/pixel-mods
claude plugin install work-board@pixel-mods --scope user
claude plugin install agent-router@pixel-mods --scope user
claude plugin install collab-hub@pixel-mods --scope user
claude plugin install safe-shell@pixel-mods --scope user
```

설치가 됐는지는 `claude plugin list`로 확인합니다. 네 mod가 `@pixel-mods`, `Scope: user`로 보이면 됩니다.

### 방법 2. Claude Code 입력창

Claude Code 터미널 세션의 입력창에 아래 줄을 하나씩 입력합니다.

```
/plugin install work-board --marketplace akaz01/pixel-mods
/plugin install agent-router --marketplace akaz01/pixel-mods
/plugin install collab-hub --marketplace akaz01/pixel-mods
/plugin install safe-shell --marketplace akaz01/pixel-mods
```

- 처음 한 번은 마켓플레이스를 추가할지 묻습니다. `y`를 누르고 설치 범위(scope)를 고릅니다. 모든 폴더에서 쓰려면 user를 고릅니다.
- 데스크톱 앱의 Code 탭에서는 이 명령을 쓸 수 없습니다. 터미널에서 user 범위로 설치하면 데스크톱 앱에서도 켜집니다.

### 업데이트

저장소에 새 버전이 올라오면 각 컴퓨터에서 마켓플레이스를 새로 받은 뒤 mod를 업데이트합니다. 바뀐 mod만 업데이트해도 됩니다.

```
claude plugin marketplace update pixel-mods
claude plugin update work-board@pixel-mods
claude plugin update agent-router@pixel-mods
claude plugin update collab-hub@pixel-mods
claude plugin update safe-shell@pixel-mods
```

업데이트가 잡히지 않으면 해당 mod의 `.claude-plugin/plugin.json`에서 `version`을 올려 다시 올립니다.

### 지우기

```
claude plugin uninstall work-board@pixel-mods
claude plugin uninstall agent-router@pixel-mods
claude plugin uninstall collab-hub@pixel-mods
claude plugin uninstall safe-shell@pixel-mods
claude plugin marketplace remove pixel-mods
```

## Folder layout

각 mod는 저장소 루트의 `<mod>/` 폴더이고, 루트의 `.claude-plugin/marketplace.json`이 네 mod를 마켓플레이스로 묶습니다.

```
<mod>/
  .claude-plugin/plugin.json
  hooks/
  types/
  tests/
```

agent-router에는 `rules.json`이 함께 있습니다.

## Try it

한 세션에서만 써 보려면 mod 폴더를 지정해 실행합니다.

```
claude --plugin-dir <mod folder>
```

테스트와 검증:

```
claude plugin test <mod folder>
claude plugin validate <mod folder>
```
