# pixel-mods

Claude Code용 mod 네 개를 모아 둔 저장소입니다. 픽셀 아트 스타일의 작업 보드(work-board)와, 보드가 읽어 가는 세 가지 보조 mod(agent-router, collab-hub, safe-shell)로 이루어져 있습니다. 각 mod는 독립된 플러그인 폴더이며, work-board는 나머지 세 mod를 의존성으로 선언합니다.

같은 네 mod를 **Windows 버전**(저장소 루트, `<mod>@pixel-mods`)과 **macOS 버전**(`macos/` 폴더, `<mod>-macos@pixel-mods`) 두 벌로 둡니다. 한 컴퓨터에는 그 OS에 맞는 한 벌만 설치합니다. 두 벌을 같이 켜면 `/board` 같은 명령이 겹쳐서 나중에 켜진 쪽이 거부됩니다. 명령 이름과 화면은 두 버전이 같습니다.

## 설치

[Claude Code](https://claude.com/claude-code)가 설치되어 있어야 합니다. 아래 한 줄을 복사해서 붙여 넣으면 나머지는 알아서 진행됩니다.

**Mac:** 터미널(Terminal) 앱을 열고 붙여 넣은 뒤 Enter를 누릅니다.

```
curl -fsSL https://raw.githubusercontent.com/akaz01/pixel-mods/main/install.sh | bash
```

**Windows:** PowerShell을 열고 붙여 넣은 뒤 Enter를 누릅니다.

```
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/akaz01/pixel-mods/main/install.ps1)))
```

실행하면 어느 버전을 설치할지 묻습니다.

```
Which version of pixel-mods should be installed?
  1) Windows
  2) macOS
Choose 1 or 2 [2]:
```

- 지금 쓰는 컴퓨터에 맞는 번호를 누릅니다. 대괄호 안의 번호가 이 컴퓨터에 맞춰 미리 골라 둔 값이라, 그냥 Enter만 눌러도 됩니다.
- 고른 버전의 네 mod가 설치됩니다. 다른 버전이 이미 깔려 있으면 먼저 지웁니다. 두 버전을 같이 켜면 `/board` 같은 명령이 겹치기 때문입니다.
- `Done.`이 나오면 끝입니다. Claude Code를 새로 열면 오른쪽에 Work Board가 자동으로 열립니다.

설치한 뒤에는 따로 켤 필요가 없습니다.

- 보드를 `/board close`로 닫으면 다음 세션부터는 자동으로 열리지 않습니다. 다시 `/board`로 열면 그다음 세션부터 다시 자동으로 열립니다.
- mod를 잠시 끄려면 `claude plugin disable <mod>@pixel-mods`, 다시 켜려면 `claude plugin enable <mod>@pixel-mods`를 씁니다. macOS에서는 mod 이름 뒤에 `-macos`가 붙습니다(예: `work-board-macos@pixel-mods`).

### 업데이트

설치할 때와 같은 한 줄을 다시 실행합니다. 새 버전을 받아서 다시 설치합니다.

### 지우기

Windows:

```
claude plugin uninstall work-board@pixel-mods
claude plugin uninstall agent-router@pixel-mods
claude plugin uninstall collab-hub@pixel-mods
claude plugin uninstall safe-shell@pixel-mods
claude plugin marketplace remove pixel-mods
```

Mac:

```
claude plugin uninstall work-board-macos@pixel-mods
claude plugin uninstall agent-router-macos@pixel-mods
claude plugin uninstall collab-hub-macos@pixel-mods
claude plugin uninstall safe-shell-macos@pixel-mods
claude plugin marketplace remove pixel-mods
```

### Windows 버전과 macOS 버전

두 버전은 명령과 기능이 같습니다. macOS 버전은 Mac 기본 터미널에서 깨끗하게 보이도록 다음이 다릅니다.

- work-board: macOS 기본 터미널(Terminal.app)은 블록 글자(`█▄▀`)를 글꼴로 그려서 칸 사이에 틈이 생기고, 겹선 테두리(`╔═╗`)도 점선처럼 끊깁니다. 그래서 macOS 버전은 다음처럼 그립니다. 글꼴이나 터미널 설정은 바꾸지 않아도 됩니다.
  - 캐릭터는 배경색 칸으로만 그립니다.
  - 창 테두리는 Terminal.app에서 깨끗하게 이어지는 둥근 홑선(`╭─╮`)을 씁니다.
  - 말풍선은 흰 칸으로 그리고, 글자는 한가운데에 들어갑니다. 왼쪽 날개가 꼬리가 되어 캐릭터를 가리킵니다.
  - 창 너비를 넘는 줄은 잘라서 보드 오른쪽 밖으로 찌꺼기가 남지 않게 하고, 오른쪽 끝에 여백을 둡니다.
- work-board: RAM은 Activity Monitor와 같은 기준(앱 메모리 + wired + 압축)으로 `vm_stat`, `sysctl`에서 읽습니다.
- collab-hub: 경로는 `/` 기준이고, 한글 파일 이름의 NFD/NFC 차이와 대소문자를 같은 파일로 봅니다. `/claim ~/파일`의 `~`는 홈 폴더입니다.
- safe-shell: PowerShell 규칙 대신 macOS 규칙을 씁니다. `/Users/<이름>`, `/System`, `/Library`, `/Applications`, `/usr` 같은 시스템 폴더 삭제와 `diskutil erase…`/`partitionDisk`는 FORBIDDEN입니다.


## Mods

### work-board

화면 오른쪽에 붙는 pixel board pane입니다. 맨 위에 노란 title band가 있습니다. 세션을 열면 자동으로 열리고, `/board close`로 닫아 두면 다음 세션부터는 열리지 않습니다.

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

## Folder layout

Windows 버전은 저장소 루트의 `<mod>/`, macOS 버전은 `macos/<mod>/` 폴더이고, 루트의 `.claude-plugin/marketplace.json`이 여덟 mod를 한 마켓플레이스로 묶습니다.

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
