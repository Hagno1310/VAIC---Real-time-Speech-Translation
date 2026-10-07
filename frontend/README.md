# OpenNezt Mobile

Base mobile application built with **React Native (Expo) + TypeScript (strict) + NativeWind (Tailwind CSS)**.

## Tech stack

| Concern         | Choice                                        |
| --------------- | --------------------------------------------- |
| Runtime         | Expo SDK 52 (React Native 0.76, New Arch)     |
| Language        | TypeScript (strict mode, no `any`)            |
| Styling         | NativeWind v4 (Tailwind CSS for RN)           |
| Navigation      | React Navigation (native-stack) |
| State           | Zustand (slices pattern)                      |
| HTTP            | Axios with interceptors                       |
| Storage         | AsyncStorage (token persistence)              |

## Getting started

```bash
cd frontend
npm install          # or: yarn / pnpm install
cp .env .env.local   # optional: machine-specific overrides
npm start            # Expo dev server (press a = Android, i = iOS, w = web)
```

Type-check and lint before every commit:

```bash
npm run typecheck
npm run lint
```

## Project structure

```
frontend/
├── assets/                 # Static files (images, fonts, icons)
├── src/
│   ├── components/
│   │   ├── ui/             # Atomic UI: Button, Input, CustomModal, Card
│   │   ├── layout/         # Container, SafeAreaWrapper, HeaderBar
│   │   ├── hooks/          # useAuth, useKeyboard, useAppState
│   │   └── utils/          # formatDate, validate, pixelRatio
│   ├── screens/            # Home/, Auth/ (Login, Register), Profile/
│   ├── store/              # Zustand store
│   │   ├── slices/         # authSlice, settingSlice
│   │   └── index.ts        # createStore + RootStore type
│   ├── navigation/         # AppNavigator, AuthStack, MainTab, types
│   ├── services/           # authService, userService (Axios calls)
│   ├── config/             # axios (interceptors), env, theme
│   ├── types/              # user, common (API contracts)
│   └── App.tsx             # Root: providers + navigator
├── .env                    # Environment template (EXPO_PUBLIC_*)
├── tsconfig.json
├── tailwind.config.js
└── claude.md               # Development rules for AI/human contributors
```

## Data flow

```
Screen → Service (Axios) → Store (Zustand slice) → Screen re-renders
                     └── config/axios attaches the token from AsyncStorage
```

## Path aliases

`@/*` maps to `src/*` (plus `@components`, `@screens`, `@navigation`, `@store`,
`@services`, `@config`, `@types`). Configured in **both** `tsconfig.json` and
`babel.config.js` — keep them in sync.

## Conventions

See **[claude.md](./claude.md)** for the full set of naming rules, folder
responsibilities and do/don't guidance. Read it before adding code.
