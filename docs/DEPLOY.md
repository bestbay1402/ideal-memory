# 설치 없이 인터넷에서 게임 열기

## 처음에는 데모부터 공개하기

1. https://vercel.com/signup 에서 **Continue with GitHub**를 누릅니다.
2. 개인 용도라면 **Hobby** 플랜을 선택합니다.
3. https://vercel.com/new 에서 GitHub 저장소 **bestbay1402/ideal-memory** 옆 **Import**를 누릅니다.
4. 저장소가 보이지 않으면 **Configure GitHub App**에서 해당 저장소 접근을 허용합니다.
5. Framework는 **Next.js**, Root Directory는 그대로, Node.js는 **24.x**로 설정합니다.
6. Environment Variables는 우선 비워두고 **Deploy**를 누릅니다.
7. 완료 화면의 **Visit**를 누릅니다. 표시된 `https://…vercel.app` 주소가 게임 접속 주소입니다.
8. 게임 화면에서 **계정 없이 로컬 데모 체험하기**를 누릅니다.

이 주소는 인터넷에서 열리며 친구에게 전달할 수 있습니다. 데모 저장은 각자의 브라우저에 남습니다.
친구가 로그인 화면을 요구받는다면 Vercel 프로젝트 **Settings → Deployment Protection**을 확인하고, 공유할 Production 배포의 접근 제한을 해제하세요. 프로젝트 설정에 따라 미리보기 배포 주소는 로그인 보호가 켜져 있을 수 있습니다.

## 계정·랭킹·채팅 켜기

README의 Supabase 연결 절차를 완료하고 Vercel 프로젝트 **Settings → Environment Variables**에 실제 값을 등록합니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (서버 비밀 키)

데이터베이스 SQL은 `001_game.sql`, `002_chat.sql`, `003_monster_kills.sql` 순서로 실행합니다.
환경변수를 저장한 뒤 Vercel에서 **Redeploy**합니다. Supabase의 로그인 주소 설정에도 실제 게임 주소를 등록합니다.

Vercel 가입/승인과 실제 서비스 키 입력은 계정 소유자가 직접 진행해야 합니다. 비밀번호나 서비스 비밀 키를 채팅 또는 GitHub에 올리지 마세요.
