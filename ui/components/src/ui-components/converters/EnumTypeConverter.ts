/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module TypeConverters */

import { PropertyDescription, EnumerationChoice, Primitives } from "@bentley/imodeljs-frontend";
import { TypeConverter } from "./TypeConverter";
import { TypeConverterManager } from "./TypeConverterManager";

/**
 * Enum Type Converter.
 * @public
 */
export class EnumTypeConverter extends TypeConverter {
  public convertPropertyToString(propertyDescription: PropertyDescription, value?: Primitives.Enum) {
    if (value === undefined)
      return "";

    if (propertyDescription.enum) {
      const pos = this.getPosition(propertyDescription.enum.choices, value);
      if (-1 !== pos)
        return propertyDescription.enum.choices[pos].label;
    }

    return super.convertToString(value);
  }

  private getPosition(choices: EnumerationChoice[], value: Primitives.Enum): number {
    for (let i = 0; i < choices.length; ++i) {
      if (choices[i].value === value)
        return i;
    }
    return -1;
  }

  public sortCompare(a: Primitives.Enum, b: Primitives.Enum, _ignoreCase?: boolean): number {
    if (isNaN(+a) || isNaN(+b)) {
      return TypeConverterManager.getConverter("string").sortCompare(a, b, _ignoreCase);
    }

    return (+a) - (+b);
  }
}
TypeConverterManager.registerConverter("enum", EnumTypeConverter);
