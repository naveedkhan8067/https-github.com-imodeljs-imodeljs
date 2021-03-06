/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { LogLevel } from "@bentley/bentleyjs-core";
import { IModelToken, DevToolsStatsOptions } from "@bentley/imodeljs-common";
import { DevTools, IModelApp, PingTestResult } from "@bentley/imodeljs-frontend";
import { assert } from "chai";

describe("DevTools", () => {
  let devTools: DevTools;

  before(async () => {
    IModelApp.startup();

    const iModelToken: IModelToken = {
      iModelId: "test",
      changeSetId: "test",
      toJSON() { return this; },
    }; // Supply a real token in an integration test
    devTools = DevTools.connectToBackendInstance(iModelToken);
  });

  after(async () => {
    IModelApp.shutdown();
  });

  it("can fetch stats from backend", async () => {
    const stats = await devTools.stats(DevToolsStatsOptions.None);
    assert.isDefined(stats);
    assert.isDefined(stats.os);
    assert.isDefined(stats.process);

    const formattedStats = await devTools.stats();
    assert.isTrue((formattedStats.os.totalmem as string).endsWith("MB"));
    assert.isTrue((formattedStats.os.uptime as string).endsWith("secs"));
    assert.isTrue((formattedStats.os.cpus[0].speed as string).endsWith("MHz"));
    assert.isTrue((formattedStats.os.cpus[0].times.user as string).endsWith("%"));
  });

  it("can ping backend", async () => {
    const pingSummary: PingTestResult = await devTools.ping(10);
    assert.isDefined(pingSummary);
    assert.isDefined(pingSummary.min);
    assert.isDefined(pingSummary.max);
    assert.isDefined(pingSummary.avg);
    assert.isTrue(pingSummary.min! <= pingSummary.avg!);
    assert.isTrue(pingSummary.avg! <= pingSummary.max!);
  });

  it("can set log level", async () => {
    const loggerCategory = "test-category";

    const firstLevel = LogLevel.Info;
    await devTools.setLogLevel(loggerCategory, firstLevel);

    const secondLevel = LogLevel.Warning;
    const actualFirstLevel = await devTools.setLogLevel(loggerCategory, secondLevel);
    assert.equal(actualFirstLevel, firstLevel);

    const thirdLevel = LogLevel.Error;
    const acutalSecondLevel = await devTools.setLogLevel(loggerCategory, thirdLevel);
    assert.equal(acutalSecondLevel, secondLevel);
  });

  it("Get the backend versions", async () => {
    const versions = await devTools.versions();
    assert.isDefined(versions.application);
    assert.isDefined(versions.iModelJs);
  });
});
