/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Rendering */

import { QParams3d } from "@bentley/imodeljs-common";
import { Range3d } from "@bentley/geometry-core";
import { Geometry } from "./GeometryPrimitives";

/** @internal */
export class GeometryList {
  private _list: Geometry[] = [];

  public get first(): Geometry | undefined { return this._list[0]; }
  public get isEmpty(): boolean { return this._list.length === 0; }
  public get length(): number { return this._list.length; }
  public push(geom: Geometry): number {
    return this._list.push(geom);
  }
  public append(src: GeometryList): GeometryList {
    this._list.push(...src._list);
    return this;
  }
  public clear(): void { this._list.length = 0; }
  public computeRange(): Range3d {
    const range: Range3d = Range3d.createNull();
    const extendRange = (geom: Geometry) => range.extendRange(geom.tileRange);
    this._list.forEach(extendRange);
    return range;
  }
  public computeQuantizationParams(): QParams3d { return QParams3d.fromRange(this.computeRange()); }

  public [Symbol.iterator]() {
    let key = 0;
    return { next: (): IteratorResult<Geometry> => { const result = key < this._list.length ? { value: this._list[key], done: false } : { value: this._list[key - 1], done: true }; key++; return result; } };
  }
}
