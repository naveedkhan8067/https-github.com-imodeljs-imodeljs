/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/

import { IModelTileRpcInterface, SnapshotIModelRpcInterface, IModelReadRpcInterface, MobileRpcManager } from "@bentley/imodeljs-common";
import { initializeBackend } from "./backend";
// tslint:disable:no-console

export function getRpcInterfaces() {
  return [IModelTileRpcInterface, SnapshotIModelRpcInterface, IModelReadRpcInterface];
}

// Initialize the backend
initializeBackend();
MobileRpcManager.initializeImpl(getRpcInterfaces());
