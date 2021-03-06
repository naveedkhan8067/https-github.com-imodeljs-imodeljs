/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module PresentationRules */

import { CustomizationRule } from "./customization/CustomizationRule";
import { NavigationRule } from "./hierarchy/NavigationRule";
import { ContentRule } from "./content/ContentRule";
import { ContentModifier } from "./content/modifiers/ContentModifier";

/**
 * Base interface for all [[Rule]] implementations. Not meant
 * to be used directly, see `Rule`.
 *
 * @public
 */
export interface RuleBase {
  /** Used for serializing to JSON. */
  ruleType: RuleTypes;

  /**
   * Defines the order in which presentation rules will be evaluated and executed. Defaults to `1000`.
   *
   * @type integer
   */
  priority?: number;

  /**
   * Should this rule should be ignored if there is already an existing
   * rule with a higher priority.
   */
  onlyIfNotHandled?: boolean;
}

/**
 * Presentation rules allow configuring the hierarchy and content.
 * @public
 */
export declare type Rule = CustomizationRule | NavigationRule | ContentRule | ContentModifier;

/**
 * Container of a [[condition]] property. Used for rules that support conditions. Not
 * meant to be used directly, see `Rule`.
 *
 * @public
 */
export interface ConditionContainer {
  /**
   * Defines a condition for the rule, which needs to be met in order to execute it. Condition
   * is an [ECExpression]($docs/learning/ECExpressions.md), which can use
   * a limited set of symbols (depends on specific `ConditionContainer`).
   */
  condition?: string;
}

/**
 * Used for serializing [[Rule]] objects to JSON.
 * @public
 */
export enum RuleTypes {
  // hierarchy rules
  RootNodes = "RootNodes",
  ChildNodes = "ChildNodes",

  // content rules
  Content = "Content",
  ContentModifier = "ContentModifier",

  // customization rules
  Grouping = "Grouping",
  PropertySorting = "PropertySorting",
  DisabledSorting = "DisabledSorting",
  InstanceLabelOverride = "InstanceLabelOverride",
  LabelOverride = "LabelOverride",
  CheckBox = "CheckBox",
  ImageIdOverride = "ImageIdOverride",
  StyleOverride = "StyleOverride",
  ExtendedData = "ExtendedData",
}
