import {
  DesktopCommercialAuthBrowserSignInCancelInputSchema,
  DesktopCommercialAuthBrowserSignInInputSchema,
  DesktopCommercialAuthSignInInputSchema,
  DesktopCommercialAuthStateSchema,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopCommercialAuth from "../../settings/DesktopCommercialAuth.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const BACKEND_AUTH_RESTART_TIMEOUT = Duration.seconds(3);

const restartBackendAfterAuthChange = Effect.fn("desktop.ipc.commercialAuth.restartBackend")(
  function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    yield* backendManager.stop({ timeout: BACKEND_AUTH_RESTART_TIMEOUT });
    yield* backendManager.start;
  },
);

export const getCommercialAuthState = makeIpcMethod({
  channel: IpcChannels.GET_COMMERCIAL_AUTH_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopCommercialAuthStateSchema,
  handler: Effect.fn("desktop.ipc.commercialAuth.getState")(function* () {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    return yield* commercialAuth.getState;
  }),
});

export const signInCommercialAuth = makeIpcMethod({
  channel: IpcChannels.SIGN_IN_COMMERCIAL_AUTH_CHANNEL,
  payload: DesktopCommercialAuthSignInInputSchema,
  result: DesktopCommercialAuthStateSchema,
  handler: Effect.fn("desktop.ipc.commercialAuth.signIn")(function* (input) {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const state = yield* commercialAuth.signIn(input);
    yield* restartBackendAfterAuthChange();
    return state;
  }),
});

export const signInCommercialAuthWithBrowser = makeIpcMethod({
  channel: IpcChannels.SIGN_IN_COMMERCIAL_AUTH_WITH_BROWSER_CHANNEL,
  payload: DesktopCommercialAuthBrowserSignInInputSchema,
  result: DesktopCommercialAuthStateSchema,
  handler: Effect.fn("desktop.ipc.commercialAuth.signInWithBrowser")(function* (input) {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const state = yield* commercialAuth.signInWithBrowser(input);
    yield* restartBackendAfterAuthChange();
    return state;
  }),
});

export const cancelCommercialAuthBrowserSignIn = makeIpcMethod({
  channel: IpcChannels.CANCEL_COMMERCIAL_AUTH_BROWSER_SIGN_IN_CHANNEL,
  payload: DesktopCommercialAuthBrowserSignInCancelInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.commercialAuth.cancelBrowserSignIn")(function* (input) {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    yield* commercialAuth.cancelBrowserSignIn(input);
  }),
});

export const signOutCommercialAuth = makeIpcMethod({
  channel: IpcChannels.SIGN_OUT_COMMERCIAL_AUTH_CHANNEL,
  payload: Schema.Void,
  result: DesktopCommercialAuthStateSchema,
  handler: Effect.fn("desktop.ipc.commercialAuth.signOut")(function* () {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    const state = yield* commercialAuth.signOut;
    yield* restartBackendAfterAuthChange();
    return state;
  }),
});
