import {
  DesktopCommercialAuthSignInInputSchema,
  DesktopCommercialAuthStateSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopCommercialAuth from "../../settings/DesktopCommercialAuth.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

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
    return yield* commercialAuth.signIn(input);
  }),
});

export const signOutCommercialAuth = makeIpcMethod({
  channel: IpcChannels.SIGN_OUT_COMMERCIAL_AUTH_CHANNEL,
  payload: Schema.Void,
  result: DesktopCommercialAuthStateSchema,
  handler: Effect.fn("desktop.ipc.commercialAuth.signOut")(function* () {
    const commercialAuth = yield* DesktopCommercialAuth.DesktopCommercialAuth;
    return yield* commercialAuth.signOut;
  }),
});
