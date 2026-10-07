# claude.md — Development Rules & Architecture Guide

> **READ THIS FIRST.** This file is the contract for anyone (AI or human) adding
> code to `frontend/`. Follow it exactly so the structure stays clean and
> predictable. When a request conflicts with these rules, ask before breaking
> them.

---

## 0. Tech stack (do not swap without approval)

- **Expo + React Native 0.76** (New Architecture enabled)
- **TypeScript strict** — `strict: true`, `noImplicitAny`, no `any`
- **NativeWind v4** (Tailwind classes via `className`)
- **React Navigation** — native-stack + bottom-tabs
- **Zustand** — global state, "slices" pattern
- **Axios** — the single shared instance in `src/config/axios.ts`
- **AsyncStorage** — token persistence only

---

## 1. Golden rules

1. **Never use `any`.** Use precise types, generics, `unknown` + narrowing, or
   add a type to `src/types/`. `any` fails review.
2. **One source of truth per concern.** Tokens live in AsyncStorage; the shared
   Axios instance is the only HTTP client; the design system lives in
   `config/theme.ts` + `tailwind.config.js`.
3. **Respect the layer boundaries** (see §3). Screens never call `axios`
   directly; services never import from `store/` or `screens/`.
4. **Every screen prop is typed** via the navigation param lists — no untyped
   `navigation`/`route`.
5. **Style with NativeWind `className`.** Reach for `StyleSheet`/inline styles
   only for dynamic values Tailwind can't express (e.g. computed sizes).
6. **Prefer named exports.** Screens/components use named exports; a folder's
   `index.ts` re-exports them. (`App.tsx` is the one default export.)
7. **Keep aliases in sync.** Any change to path aliases must land in **both**
   `tsconfig.json` and `babel.config.js`.

---

## 2. Naming conventions

| Kind                         | Convention           | Example                         |
| ---------------------------- | -------------------- | ------------------------------- |
| Component / Screen file      | `PascalCase.tsx`     | `Button.tsx`, `HomeScreen.tsx`  |
| Hook file & function         | `useCamelCase.ts`    | `useAuth.ts` → `useAuth()`      |
| Service file                 | `camelCaseService.ts`| `authService.ts`                |
| Store slice                  | `camelCaseSlice.ts`  | `authSlice.ts`                  |
| Types file                   | `camelCase.ts`       | `user.ts`, `common.ts`          |
| Type / Interface             | `PascalCase`         | `User`, `ApiResponse<T>`        |
| Constant                     | `UPPER_SNAKE_CASE`   | `STORAGE_KEYS`                  |
| Variable / function          | `camelCase`          | `loadUsers`, `isFormValid`      |
| Folder                       | `PascalCase` (screens/feature) · `lowercase` (infra) | `Profile/` · `services/` |
| Barrel file                  | `index.ts`           | re-export only                  |

- Screens end with the `Screen` suffix (`ProfileScreen`), live in a
  `PascalCase` folder, and are re-exported from that folder's `index.ts`.
- Boolean values/props read as predicates: `isLoading`, `hasError`, `canSubmit`.
- Async actions are verbs: `login`, `fetchProfile`, `refreshToken`.

---

## 3. Folder responsibilities (who owns what)

Import direction only flows **downward**. A layer may import from layers below
it, never above.

```
screens ─▶ components ─▶ (hooks, utils)
   │            │
   ▼            ▼
 store  ◀──── services ─▶ config ─▶ types
```

### `src/config/` — infrastructure
- `axios.ts` — the ONE Axios instance + interceptors (attaches bearer token
  from AsyncStorage, normalises errors to `ApiError`, clears token on 401).
  Also owns `STORAGE_KEYS`.
- `env.ts` — typed, validated env access. **Only file allowed to read
  `process.env`.**
- `theme.ts` — design tokens (colors, spacing, fontSize, radius). Mirror color
  changes into `tailwind.config.js`.
- **Never** import from `store/`, `services/`, `screens/`, or `components/`.

### `src/types/` — shared types
- `common.ts` — API contracts (`ApiResponse`, `Paginated`, `ApiError`,
  `AuthTokens`, `RequestStatus`).
- `user.ts` — user domain + payload types.
- Pure types only. Zero runtime code, zero imports from other layers.

### `src/services/` — API layer
- One file per resource (`authService.ts`, `userService.ts`).
- Uses the shared `api` from `config/axios`. Returns the **unwrapped** `data`
  payload and lets the normalised `ApiError` propagate.
- **Never** touches React, the store, navigation, or AsyncStorage directly
  (token handling belongs to the interceptor / auth slice).

### `src/store/` — global state (Zustand)
- `slices/*.ts` — a `StateCreator<RootStore, [], [], XSlice>` per domain.
  Async actions live here and call services; they own loading/error status.
- `index.ts` — merges slices into `RootStore` and exports `useStore`.
- Components select the **minimal** state they need (see §5). Persist only what
  must survive a restart (tokens → AsyncStorage).

### `src/navigation/` — routing
- `types.ts` — `*ParamList` + per-screen prop helpers. **Add a route here
  first**, then wire it up. Update the global `ReactNavigation.RootParamList`
  augmentation.
- `AppNavigator.tsx` (root) → `RttStack.tsx` (the translator flow, routes in
  `rttTypes.ts`). The Auth/Main template stacks were removed (see git history).

### `src/components/` — reusable UI & logic
- `ui/` — atomic, presentational, **stateless-ish** widgets (`Button`, `Input`,
  `CustomModal`, `Card`). No API calls, no store access, no navigation.
- `layout/` — structural wrappers (`SafeAreaWrapper`, `Container`, `HeaderBar`).
- `hooks/` — reusable logic (`useAuth`, `useKeyboard`, `useAppState`). May read
  the store; must not render UI.
- `utils/` — pure functions only (`formatDate`, `validate`, `pixelRatio`). No
  React, no side effects.

### `src/screens/` — feature screens
- Compose components + hooks + services + store into a screen. This is the ONLY
  layer that orchestrates the full flow. One folder per feature, `index.ts`
  re-exports.

---

## 4. The canonical data flow

```
User action ─▶ Screen ─▶ Service (Axios)
                          └─ interceptor attaches token from AsyncStorage
        ┌───────────────────┘
        ▼
   Store slice action (sets loading → success/error, stores data)
        │
        ▼
   Screen re-renders from selected state
```

- Server data that many screens share → **store**.
- Data local to one screen → **`useState` in that screen** (see `Demo4Meeting`).
- Never call a service from `ui/` or `utils/`.

---

## 5. TypeScript & React rules

- **No `any`.** Prefer `unknown` + a type guard (`isApiError`) over casts.
- Type component props with an exported `interface XProps`. Extend the native
  props (`TouchableOpacityProps`, `TextInputProps`) when wrapping a primitive.
- Screen components: `type Props = XStackScreenProps<'RouteName'>` — never
  hand-roll `navigation`/`route` types.
- With Zustand v5, selecting an **object** requires `useShallow` (see
  `useAuth.ts`) to avoid infinite re-renders. Selecting a single value is fine.
- Fire-and-forget promises are marked with `void` (`void loadUsers()`), or
  awaited — never left dangling.
- Handle every async state: **loading / error / empty / success**.

---

## 6. Styling rules (NativeWind)

- Use `className` with Tailwind utilities. Compose conditional classes with an
  array `.join(' ')` (see `Button.tsx`), not string concatenation soup.
- Use theme colors via Tailwind tokens (`bg-primary`, `text-danger`) — these are
  defined in `tailwind.config.js`, mirroring `config/theme.ts`.
- Raw `theme.colors.*` values are for non-className surfaces only (navigation
  theme, `StatusBar`, `ActivityIndicator`, imperative styles).
- Keep spacing on the Tailwind scale; avoid magic pixel numbers.

---

## 7. Adding things — quick recipes

**New API resource**
1. Add domain types to `src/types/<name>.ts`.
2. Create `src/services/<name>Service.ts` using the shared `api`.
3. If globally shared, add a slice in `store/slices/` and merge it in
   `store/index.ts`.

**New screen**
1. Add the route to the correct `*ParamList` in `navigation/types.ts`.
2. Create `src/screens/<Feature>/<Feature>Screen.tsx` + `index.ts`.
3. Register it in `RttStack.tsx` (route in `rttTypes.ts`).
4. Type props with the matching `*ScreenProps<'Route'>` helper.

**New reusable component**
1. Put atomic widgets in `ui/`, wrappers in `layout/`.
2. Export an `interface XProps`; re-export from the folder `index.ts`.

**New env variable**
1. Add `EXPO_PUBLIC_<NAME>` to `.env`.
2. Read + validate it in `config/env.ts`. Never read `process.env` elsewhere.

---

## 8. Do NOT

- ❌ Use `any` or silence the compiler with `// @ts-ignore`.
- ❌ Create a second Axios instance or call `fetch`/`axios` from a screen.
- ❌ Read/write AsyncStorage tokens outside `config/axios.ts` + `authSlice.ts`.
- ❌ Import `store/` or `screens/` from `services/`, `config/`, or `types/`.
- ❌ Hardcode the API URL, colors, or spacing — use `env` / theme tokens.
- ❌ Put business logic in `ui/` or side effects in `utils/`.
- ❌ Navigate with string literals not present in a `*ParamList`.
- ❌ Add a dependency without updating `package.json` and this file if it
  changes a convention.

---

## 9. Before you finish

Run and make sure both pass:

```bash
npm run typecheck   # tsc --noEmit, zero errors
npm run lint
```

Keep this file updated when a convention changes — it is the shared memory of
the project.
