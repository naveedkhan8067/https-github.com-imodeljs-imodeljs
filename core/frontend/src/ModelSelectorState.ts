/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Views */

import { Id64, Id64Arg, Id64String } from "@bentley/bentleyjs-core";
import { ElementState } from "./EntityState";
import { IModelConnection } from "./IModelConnection";
import { ModelSelectorProps } from "@bentley/imodeljs-common";
import { SpatialClassification } from "./SpatialClassification";

/** The state of a [ModelSelector]($backend). It holds a set of ids of GeometricModels for a [[SpatialViewState]].
 * It defines the set of [[ModelState]]s drawn within the view as a set of IDs.
 * @public
 */
export class ModelSelectorState extends ElementState {
  /** @internal */
  public static get className() { return "ModelSelector"; }

  /** The set of ModelIds of this ModelSelectorState */
  public readonly models = new Set<string>();
  constructor(props: ModelSelectorProps, iModel: IModelConnection) {
    super(props, iModel);
    if (props.models)
      props.models.forEach((model) => this.models.add(model));
  }

  /** The name of this ModelSelector */
  public get name(): string { return this.code.getValue(); }

  public toJSON(): ModelSelectorProps {
    const val: any = super.toJSON();
    val.models = [];
    this.models.forEach((model) => val.models.push(model));
    return val;
  }

  /** Determine if this model selector is logically equivalent to the specified model selector. Two model selectors are logically equivalent is
   * they have the same name and Id and contain the same set of models.
   * @param other The model selector to which to compare.
   * @returns true if the model selectors are logically equivalent.
   * @public
   */
  public equalState(other: ModelSelectorState): boolean {
    if (this.models.size !== other.models.size || this.id !== other.id || this.name !== other.name)
      return false;

    const otherIter = other.models.keys();
    let otherRes = otherIter.next();
    for (let thisIter = this.models.keys(), thisRes = thisIter.next(); !thisRes.done; thisRes = thisIter.next(), otherRes = otherIter.next()) {
      if (thisRes.value !== otherRes.value)
        return false;
    }

    return true;
  }

  /** Add one or more models to this ModelSelectorState */
  public addModels(arg: Id64Arg): void {
    Id64.forEach(arg, (id) => this.models.add(id));
  }

  /** Drop one or more models from this ModelSelectorState */
  public dropModels(arg: Id64Arg): void {
    Id64.forEach(arg, (id) => this.models.delete(id));
  }

  /** Determine whether this ModelSelectorState includes the specified modelId value */
  public has(id: string): boolean { return this.models.has(id); }

  /** Determine whether this ModelSelectorState includes the specified modelId */
  public containsModel(modelId: Id64String): boolean { return this.has(modelId.toString()); }

  /** Make sure all models referenced by this ModelSelectorState are loaded. */
  public async load(): Promise<void> {

    return this.iModel.models.load(this.models).then(async (_) => SpatialClassification.loadModelClassifiers(this.models, this.iModel));
  }
}
