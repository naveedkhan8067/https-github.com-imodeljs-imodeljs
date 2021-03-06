/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Core */

import { Id64, GuidString, Guid, Id64String } from "@bentley/bentleyjs-core";
import { InstanceId, InstanceKey } from "./EC";
import { NodeKey, NodeKeyJSON } from "./hierarchy/Key";
import { EntityProps } from "@bentley/imodeljs-common";
import { PresentationError, PresentationStatus } from "./Error";

/**
 * A single key that identifies something in iModel.js application
 * @public
 */
export type Key = Readonly<NodeKey> | Readonly<InstanceKey> | Readonly<EntityProps>;

/** @public */
export namespace Key {
  /** Check if the supplied key is a `NodeKey` */
  export function isNodeKey(key: Key): key is NodeKey {
    return (key as any).type;
  }

  /** Check if the supplied key is an `InstanceKey` */
  export function isInstanceKey(key: Key): key is InstanceKey {
    return (key as any).className && (key as any).id;
  }

  /** Check if the supplied key is an `EntityProps` */
  export function isEntityProps(key: Key): key is EntityProps {
    return (key as any).classFullName && (key as any).id;
  }
}

/**
 * A type for multiple keys that identify something in iModel.js application
 * @public
 */
export type Keys = ReadonlyArray<Key> | Readonly<KeySet>;

/**
 * A data structure of serialized [[KeySet]]
 * @internal
 */
export interface KeySetJSON {
  instanceKeys: Array<[string, string[]]>;
  nodeKeys: NodeKeyJSON[];
}

/**
 * A class that holds multiple [[Key]] objects. It's basically
 * used as a container that holds multiple keys of different types.
 *
 * @public
 */
export class KeySet {
  // note: all keys are stored as strings because we need ability to find them by value
  private _instanceKeys: Map<string, Set<string>>; // class name => instance ids
  private _nodeKeys: Set<string>;
  private _guid: GuidString;

  /**
   * Creates an instance of KeySet.
   * @param source Optional source to initialize from.
   */
  constructor(source?: Keys) {
    this._instanceKeys = new Map();
    this._nodeKeys = new Set();
    this._guid = Guid.createValue();
    if (source)
      this.add(source);
  }

  /**
   * Get a GUID that identifies changes in this keyset. The value
   * does not uniquely identify contents of the keyset, but it can be
   * used to check whether keyset has changed.
   */
  public get guid(): GuidString { return this._guid; }

  /**
   * Get a map of instance keys stored in this KeySet
   *
   * **Warning**: getting instance keys might be expensive for
   * large KeySets.
   */
  public get instanceKeys(): Map<string, Set<InstanceId>> {
    const map = new Map<string, Set<InstanceId>>();
    for (const entry of this._instanceKeys)
      map.set(entry["0"], new Set([...entry["1"]].map((key: string) => Id64.fromJSON(key))));
    return map;
  }

  /**
   * Get instance keys count
   */
  public get instanceKeysCount(): number {
    let count = 0;
    this._instanceKeys.forEach((set: Set<string>) => count += set.size);
    return count;
  }

  /**
   * Get a set of node keys stored in this KeySet
   *
   * **Warning**: getting node keys might be expensive for
   * large KeySets.
   */
  public get nodeKeys(): Set<NodeKey> {
    const set = new Set<NodeKey>();
    for (const serialized of this._nodeKeys) {
      const key = NodeKey.fromJSON(JSON.parse(serialized));
      set.add(key);
    }
    return set;
  }

  /**
   * Get node keys count
   */
  public get nodeKeysCount(): number {
    return this._nodeKeys.size;
  }

  private isKeySet(set: Keys | Key): set is Readonly<KeySet> {
    return (set as any)._nodeKeys && (set as any)._instanceKeys;
  }

  private isKeysArray(keys: Keys | Key): keys is ReadonlyArray<Key> {
    return Array.isArray(keys);
  }

  /**
   * Clear this KeySet.
   * @returns itself
   */
  public clear(): KeySet {
    if (this.isEmpty)
      return this;

    this._instanceKeys = new Map();
    this._nodeKeys = new Set();
    this._guid = Guid.createValue();
    return this;
  }

  private addKeySet(keyset: Readonly<KeySet>, pred?: (key: Key) => boolean): void {
    for (const key of (keyset as any)._nodeKeys) {
      if (!pred || pred(NodeKey.fromJSON(JSON.parse(key))))
        this._nodeKeys.add(key);
    }
    for (const entry of (keyset as any)._instanceKeys) {
      let set = this._instanceKeys.get(entry["0"]);
      if (!set) {
        set = new Set();
        this._instanceKeys.set(entry["0"], set);
      }
      entry["1"].forEach((id: Id64String) => {
        if (!pred || pred({ className: entry[0], id }))
          set!.add(id);
      });
    }
  }

  private addKeySetJSON(keyset: Readonly<KeySetJSON>): void {
    for (const key of keyset.nodeKeys)
      this._nodeKeys.add(JSON.stringify(key));
    for (const entry of keyset.instanceKeys)
      this._instanceKeys.set(entry["0"], new Set(entry["1"]));
  }

  /**
   * Add a key or keys to this KeySet.
   * @param value A key or keys to add.
   * @param pred An optional predicate function that indicates whether a key should be added
   * @returns itself
   */
  public add(value: Keys | Key, pred?: (key: Key) => boolean): KeySet {
    if (!value)
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
    const sizeBefore = this.size;
    if (this.isKeySet(value)) {
      this.addKeySet(value, pred);
    } else if (this.isKeysArray(value)) {
      value.forEach((key) => (!pred || pred(key)) ? this.add(key) : undefined);
    } else if (Key.isEntityProps(value)) {
      this.add({ className: value.classFullName, id: Id64.fromJSON(value.id) } as InstanceKey);
    } else if (Key.isInstanceKey(value)) {
      if (!this._instanceKeys.has(value.className))
        this._instanceKeys.set(value.className, new Set());
      this._instanceKeys.get(value.className)!.add(value.id);
    } else if (Key.isNodeKey(value)) {
      this._nodeKeys.add(JSON.stringify(value));
    } else {
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
    }
    if (this.size !== sizeBefore)
      this._guid = Guid.createValue();
    return this;
  }

  private deleteKeySet(keyset: Readonly<KeySet>): void {
    for (const key of (keyset as any)._nodeKeys)
      this._nodeKeys.delete(key);
    for (const entry of (keyset as any)._instanceKeys) {
      const set = this._instanceKeys.get(entry["0"]);
      if (set) {
        entry["1"].forEach((key: string) => {
          set.delete(key);
        });
      }
    }
  }

  /**
   * Deletes a key or keys from this KeySet.
   * @param value A key or keys to delete.
   * @returns itself
   */
  public delete(value: Keys | Key): KeySet {
    if (!value)
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
    const sizeBefore = this.size;
    if (this.isKeySet(value)) {
      this.deleteKeySet(value);
    } else if (this.isKeysArray(value)) {
      for (const key of value)
        this.delete(key);
    } else if (Key.isEntityProps(value)) {
      this.delete({ className: value.classFullName, id: value.id! } as InstanceKey);
    } else if (Key.isInstanceKey(value)) {
      const set = this._instanceKeys.get(value.className);
      if (set)
        set.delete(value.id);
    } else if (Key.isNodeKey(value)) {
      this._nodeKeys.delete(JSON.stringify(value));
    } else {
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
    }
    if (this.size !== sizeBefore)
      this._guid = Guid.createValue();
    return this;
  }

  /**
   * Check if this KeySet contains the specified key.
   * @param value The key to check.
   */
  public has(value: Key): boolean {
    if (!value)
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
    if (Key.isEntityProps(value))
      return this.has({ className: value.classFullName, id: value.id! } as InstanceKey);
    if (Key.isInstanceKey(value)) {
      const set = this._instanceKeys.get(value.className);
      return !!(set && set.has(value.id));
    }
    if (Key.isNodeKey(value))
      return this._nodeKeys.has(JSON.stringify(value));
    throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${value}`);
  }

  private hasKeySet(readonlyKeys: Readonly<KeySet>, checkType: "all" | "any"): boolean {
    // note: cast-away read-onlyness to access private members...
    const keys = readonlyKeys as KeySet;

    if (checkType === "all") {
      if (this._nodeKeys.size < keys._nodeKeys.size || this._instanceKeys.size < keys._instanceKeys.size)
        return false;
      if ([...keys._nodeKeys].some((key) => !this._nodeKeys.has(key)))
        return false;
      for (const otherEntry of keys._instanceKeys) {
        const thisEntryKeys = this._instanceKeys.get(otherEntry["0"]);
        if (!thisEntryKeys || thisEntryKeys.size < otherEntry["1"].size)
          return false;
        if ([...otherEntry["1"]].some((key) => !thisEntryKeys.has(key)))
          return false;
      }
      return true;
    }

    // "any" check type
    if ([...keys._nodeKeys].some((key) => this._nodeKeys.has(key)))
      return true;
    for (const otherEntry of keys._instanceKeys) {
      const thisEntryKeys = this._instanceKeys.get(otherEntry["0"]);
      if (thisEntryKeys && [...otherEntry["1"]].some((key) => thisEntryKeys.has(key)))
        return true;
    }
    return false;
  }

  private hasKeysArray(keys: ReadonlyArray<Key>, checkType: "all" | "any"): boolean {
    if (checkType === "all") {
      if (this.size < keys.length)
        return false;
      for (const key of keys) {
        if (!this.has(key))
          return false;
      }
      return true;
    }

    // "any" check type
    for (const key of keys) {
      if (this.has(key))
        return true;
    }
    return false;
  }

  /**
   * Check if this KeySet contains all the specified keys.
   * @param keys The keys to check.
   */
  public hasAll(keys: Keys): boolean {
    if (!keys)
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${keys}`);
    if (this.isKeySet(keys))
      return this.hasKeySet(keys, "all");
    if (this.isKeysArray(keys))
      return this.hasKeysArray(keys, "all");
    throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: keys = ${keys}`);
  }

  /**
   * Check if this KeySet contains any of the specified keys.
   * @param keys The keys to check.
   */
  public hasAny(keys: Keys): boolean {
    if (!keys)
      throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: value = ${keys}`);
    if (this.isKeySet(keys))
      return this.hasKeySet(keys, "any");
    if (this.isKeysArray(keys))
      return this.hasKeysArray(keys, "any");
    throw new PresentationError(PresentationStatus.InvalidArgument, `Invalid argument: keys = ${keys}`);
  }

  /**
   * Get the number of keys stored in this KeySet.
   */
  public get size(): number {
    const nodeKeysCount = this._nodeKeys.size;
    let instanceIdsCount = 0;
    for (const set of this._instanceKeys.values())
      instanceIdsCount += set.size;
    return nodeKeysCount + instanceIdsCount;
  }

  /**
   * Is this KeySet currently empty.
   */
  public get isEmpty(): boolean {
    return 0 === this.size;
  }

  /**
   * Serializes this KeySet to JSON
   * @internal
   */
  public toJSON(): KeySetJSON {
    const instanceKeys = new Array();
    for (const entry of this._instanceKeys.entries()) {
      if (entry["1"].size > 0)
        instanceKeys.push([entry["0"], [...entry["1"]]]);
    }
    const nodeKeys = new Array<NodeKeyJSON>();
    for (const serializedKey of this._nodeKeys.values())
      nodeKeys.push(JSON.parse(serializedKey));
    return {
      instanceKeys,
      nodeKeys,
    };
  }

  /**
   * Creates a KeySet from JSON
   * @internal
   */
  public static fromJSON(json: KeySetJSON): KeySet {
    const keyset = new KeySet();
    keyset.addKeySetJSON(json);
    return keyset;
  }
}
