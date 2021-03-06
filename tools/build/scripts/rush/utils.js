/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
function logBuildWarning(msg) {
  // Since we run both a windows and linux build, only printing warnings with the "#vso..." prefix should avoid duplicates in build summaries
  if (process.env.TF_BUILD && process.platform === "win32")
    console.log("##vso[task.logissue type=warning;]%s", msg);
  else
    console.error("WARNING: %s", msg);
}

function logBuildError(msg) {
  if (process.env.TF_BUILD)
    console.log("##vso[task.logissue type=error;]%s", msg);
  else
    console.error("ERROR: %s", msg);
}

function failBuild() {
  if (process.env.TF_BUILD) {
    console.log("##vso[task.complete result=Failed;]DONE")
    process.exit(0);
  } else {
    process.exit(1);
  }
}

module.exports = {
  logBuildWarning,
  logBuildError,
  failBuild
}