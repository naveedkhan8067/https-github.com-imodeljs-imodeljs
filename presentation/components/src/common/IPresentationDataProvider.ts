/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Core */

import { IModelConnection } from "@bentley/imodeljs-frontend";

/**
 * Interface for a presentation data provider
 * @public
 */
export interface IPresentationDataProvider {
  /**
   * [[IModelConnection]] used by this data provider
   */
  readonly imodel: IModelConnection;

  /**
   * Id of the ruleset used by this data provider
   */
  readonly rulesetId: string;
}
