/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import {
  ClientRequestContext,
  BeEvent,
  DbResult,
  Guid,
  Id64,
  Id64String,
  using,
  Logger,
  LogLevel,
  GetMetaDataFunction,
} from "@bentley/bentleyjs-core";
import {
  Angle,
  GeometryQuery,
  LineString3d,
  Loop,
  Matrix4d,
  Point3d,
  Range3d,
  Transform,
  StrokeOptions,
  PolyfaceBuilder,
  YawPitchRollAngles,
} from "@bentley/geometry-core";
import { AccessToken, IAuthorizationClient } from "@bentley/imodeljs-clients";
import {
  AxisAlignedBox3d, Code, CodeScopeSpec, CodeSpec, ColorByName, EntityMetaData, EntityProps, FilePropertyProps, FontMap,
  FontType, GeometricElementProps, IModel, IModelError, IModelStatus, PrimitiveTypeCode, RelatedElement, SubCategoryAppearance,
  ViewDefinitionProps, DisplayStyleSettingsProps, ColorDef, ViewFlags, RenderMode, DisplayStyleProps, BisCodeSpec, ImageSourceFormat,
  TextureFlags, TextureMapping, TextureMapProps, TextureMapUnits, GeometryStreamBuilder, GeometricElement3dProps, GeometryParams,
} from "@bentley/imodeljs-common";
import { assert, expect } from "chai";
import * as path from "path";
import {
  AutoPush, AutoPushParams, AutoPushEventHandler, AutoPushEventType, AutoPushState, BisCoreSchema, Category, ClassRegistry, DefinitionPartition,
  DictionaryModel, DocumentPartition, ECSqlStatement, Element, ElementGroupsMembers, Entity,
  GeometricElement2d, GeometricElement3d, GeometricModel, GroupInformationPartition, IModelDb, InformationPartitionElement,
  LightLocation, LinkPartition, Model, PhysicalModel, PhysicalPartition, RenderMaterialElement, SpatialCategory, SqliteStatement, SqliteValue,
  SqliteValueType, SubCategory, Subject, Texture, ViewDefinition, DisplayStyle3d, ElementDrivesElement, PhysicalObject, BackendRequestContext,
} from "../../imodeljs-backend";
import { DisableNativeAssertions, IModelTestUtils } from "../IModelTestUtils";
import { KnownTestLocations } from "../KnownTestLocations";
import { IModelHost } from "../../IModelHost";

let lastPushTimeMillis = 0;
let lastAutoPushEventType: AutoPushEventType | undefined;

// spell-checker: disable

async function getIModelError<T>(promise: Promise<T>): Promise<IModelError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof IModelError ? err : undefined;
  }
}

function expectIModelError(expectedErrorNumber: IModelStatus, error: IModelError | undefined): void {
  expect(error).not.to.be.undefined;
  expect(error).instanceof(IModelError);
  expect(error!.errorNumber).to.equal(expectedErrorNumber);
}

function exerciseGc() {
  for (let i = 0; i < 1000; ++i) {
    const obj = { value: i };
    const fmt = obj.value.toString();
    assert.isTrue(i === parseInt(fmt, 10));
  }
}

describe("iModel", () => {
  let imodel1: IModelDb;
  let imodel2: IModelDb;
  let imodel3: IModelDb;
  let imodel4: IModelDb;
  let imodel5: IModelDb;
  const requestContext = new BackendRequestContext();

  before(async () => {
    IModelTestUtils.registerTestBimSchema();
    imodel1 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "test.bim"), IModelTestUtils.resolveAssetFile("test.bim"));
    imodel2 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "CompatibilityTestSeed.bim"), IModelTestUtils.resolveAssetFile("CompatibilityTestSeed.bim"));
    imodel3 = IModelDb.openSnapshot(IModelTestUtils.resolveAssetFile("GetSetAutoHandledStructProperties.bim"));
    imodel4 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "GetSetAutoHandledArrayProperties.bim"), IModelTestUtils.resolveAssetFile("GetSetAutoHandledArrayProperties.bim"));
    imodel5 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "mirukuru.ibim"), IModelTestUtils.resolveAssetFile("mirukuru.ibim"));

    const schemaPathname = path.join(KnownTestLocations.assetsDir, "TestBim.ecschema.xml");
    await imodel1.importSchema(requestContext, schemaPathname); // will throw an exception if import fails
  });

  after(() => {
    imodel1.closeSnapshot();
    imodel2.closeSnapshot();
    imodel3.closeSnapshot();
    imodel4.closeSnapshot();
    imodel5.closeSnapshot();
  });

  /** test the copy constructor and to/from Json methods for the supplied entity */
  const testCopyAndJson = (entity: Entity) => {
    const copyOf = entity.clone();
    const s1 = JSON.stringify(entity); let s2 = JSON.stringify(copyOf);
    assert.equal(s1, s2);

    // now round trip the entity through a json string and back to a new entity.
    const jsonObj = JSON.parse(s1) as EntityProps;
    const el2 = new (entity.constructor as any)(jsonObj, entity.iModel); // create a new entity from the json
    s2 = JSON.stringify(el2);
    assert.equal(s1, s2);
  };

  it("should verify object vault", () => {
    const platform = IModelHost.platform!;

    const o1 = "o1";
    platform.storeObjectInVault({ thisIs: "obj1" }, o1);
    exerciseGc();
    assert.deepEqual(platform.getObjectFromVault(o1), { thisIs: "obj1" });
    assert.equal(platform.getObjectRefCountFromVault(o1), 1);

    const o2 = "o2";
    platform.storeObjectInVault({ thatIs: "obj2" }, o2);
    exerciseGc();
    assert.deepEqual(platform.getObjectFromVault(o2), { thatIs: "obj2" });
    exerciseGc();
    assert.equal(platform.getObjectRefCountFromVault(o2), 1);

    platform.storeObjectInVault(platform.getObjectFromVault(o1), o1); // this is one way to increase the ref count on obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 2);
    assert.equal(platform.getObjectRefCountFromVault(o2), 1);

    platform.addReferenceToObjectInVault(o1); // this is the more direct way to increase the ref count to obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 3);

    platform.dropObjectFromVault(o1); // decrease the ref count on obj1
    platform.dropObjectFromVault(o1); // decrease the ref count on obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 1);

    exerciseGc();

    platform.dropObjectFromVault(o1); // remove the only remaining reference to obj1
    try {
      platform.getObjectFromVault(o1);
    } catch (_err) {
      // expected
    }
    try {
      platform.dropObjectFromVault(o1); // this is ID is invalid and should be rejected.
    } catch (_err) {
      // expected
    }

    assert.equal(platform.getObjectRefCountFromVault(o2), 1);
    assert.deepEqual(platform.getObjectFromVault(o2), { thatIs: "obj2" });
    platform.dropObjectFromVault(o2); // remove the only reference to obj2
    try {
      platform.getObjectFromVault(o2);
    } catch (_err) {
      // expected
    }
  });

  it("should do logging from worker threads in correct context", async () => {

    const contextForTest = new ClientRequestContext("contextForTest");
    const contextForStepAsync = new ClientRequestContext("contextForStepAsync");

    const testMessage = "message from test in main";

    const expectedMsgsInOrder: any[] = [
      { message: "ECSqlStepWorker: Start on main thread", ctx: contextForStepAsync },
      { message: testMessage, ctx: contextForTest },
      { message: "ECSqlStepWorker: In worker thread", ctx: contextForStepAsync },
      { message: "ECSqlStepWorker: Back on main thread", ctx: contextForStepAsync },
    ];

    const msgs: any[] = [];
    Logger.initialize((_category: string, message: string, _metaData?: GetMetaDataFunction) => {
      msgs.push({ message, ctx: ClientRequestContext.current });
    });
    Logger.setLevel("ECSqlStepWorkerTestCategory", LogLevel.Error);
    const stmt = imodel1.prepareStatement("SELECT * from bis.Element");

    contextForStepAsync.enter();        // the statement should run entirely in contextForStepAsync
    const stepPromise = stmt.stepAsync();

    contextForTest.enter();             // while the statement runs, the test switches to a new context
    Logger.logError("ECSqlStepWorkerTestCategory", testMessage);

    const res = await stepPromise;      // now the statement completes.
    assert.equal(res, DbResult.BE_SQLITE_ROW);

    assert.strictEqual(ClientRequestContext.current, contextForTest);

    assert.equal(msgs.length, expectedMsgsInOrder.length);
    for (let i = 0; i < msgs.length; ++i) {
      assert.equal(msgs[i].message, expectedMsgsInOrder[i].message);
      assert.strictEqual(msgs[i].ctx, expectedMsgsInOrder[i].ctx);
    }

    stmt.dispose();
  });

  it("should be able to get properties of an iIModel", () => {
    expect(imodel1.name).equals("TBD"); // That's the name of the root subject!
    const extents: AxisAlignedBox3d = imodel1.projectExtents;
    assert(!extents.isNull);

    // make sure we can construct a new element even if we haven't loaded its metadata (will be loaded in ctor)
    assert.isUndefined(imodel1.classMetaDataRegistry.find("biscore:lightlocation"));
    const e1 = new LightLocation({ category: "0x11", classFullName: "BisCore.LightLocation", model: "0x01", code: Code.createEmpty() }, imodel1);
    assert.isDefined(e1);
    assert.isDefined(imodel1.classMetaDataRegistry.find("biscore:lightlocation")); // should have been loaded in ctor
  });

  it("should use schema to look up classes by name", () => {
    const elementClass = ClassRegistry.findRegisteredClass(Element.classFullName);
    const categoryClass = ClassRegistry.findRegisteredClass(Category.classFullName);
    assert.isDefined(elementClass);
    assert.isDefined(categoryClass);
    assert.equal(elementClass!.schema, BisCoreSchema);
    assert.equal(categoryClass!.schema, BisCoreSchema);
    assert.equal(elementClass!.className, "Element");
    assert.equal(categoryClass!.className, "Category");
  });

  it("FontMap", () => {
    const fonts1 = imodel1.fontMap;
    assert.equal(fonts1.fonts.size, 4, "font map size should be 4");
    assert.equal(FontType.TrueType, fonts1.getFont(1)!.type, "get font 1 type is TrueType");
    assert.equal("Arial", fonts1.getFont(1)!.name, "get Font 1 name");
    assert.equal(1, fonts1.getFont("Arial")!.id, "get Font 1, by name");
    assert.equal(FontType.Rsc, fonts1.getFont(2)!.type, "get font 2 type is Rsc");
    assert.equal("Font0", fonts1.getFont(2)!.name, "get Font 2 name");
    assert.equal(2, fonts1.getFont("Font0")!.id, "get Font 2, by name");
    assert.equal(FontType.Shx, fonts1.getFont(3)!.type, "get font 1 type is Shx");
    assert.equal("ShxFont0", fonts1.getFont(3)!.name, "get Font 3 name");
    assert.equal(3, fonts1.getFont("ShxFont0")!.id, "get Font 3, by name");
    assert.equal(FontType.TrueType, fonts1.getFont(4)!.type, "get font 4 type is TrueType");
    assert.equal("Calibri", fonts1.getFont(4)!.name, "get Font 4 name");
    assert.equal(4, fonts1.getFont("Calibri")!.id, "get Font 3, by name");
    assert.isUndefined(fonts1.getFont("notfound"), "attempt lookup of a font that should not be found");
    assert.deepEqual(new FontMap(fonts1.toJSON()), fonts1, "toJSON on FontMap");
  });

  it("should load a known element by Id from an existing iModel", () => {
    assert.exists(imodel1.elements);
    const code1 = new Code({ spec: "0x10", scope: "0x11", value: "RF1.dgn" });
    const el = imodel1.elements.getElement(code1);
    assert.exists(el);
    const el2ById = imodel1.elements.getElement("0x34");
    assert.exists(el2ById);
    const el2ByString = imodel1.elements.getElement("0x34");
    assert.exists(el2ByString);
    const badCode = new Code({ spec: "0x10", scope: "0x11", value: "RF1_does_not_exist.dgn" });

    try {
      imodel1.elements.getElement(badCode); // throws Error
      assert.fail(); // this line should be skipped
    } catch (error) {
      assert.instanceOf(error, Error);
      assert.instanceOf(error, IModelError);
      assert.equal(error.errorNumber, IModelStatus.NotFound);
    }

    const subCat = imodel1.elements.getElement("0x2e");
    assert.isTrue(subCat instanceof SubCategory);
    if (subCat instanceof SubCategory) {
      assert.isTrue(subCat.appearance.color.tbgr === 16777215);
      assert.isTrue(subCat.appearance.weight === 2);
      assert.equal(Id64.getLocalId(subCat.id), 46);
      assert.equal(Id64.getBriefcaseId(subCat.id), 0);
      assert.equal(Id64.getLocalId(subCat.code.spec), 30);
      assert.equal(Id64.getBriefcaseId(subCat.code.spec), 0);
      assert.isTrue(subCat.code.scope === "0x2d");
      assert.isTrue(subCat.code.value === "A-Z013-G-Legn");
      testCopyAndJson(subCat);
    }

    /// Get the parent Category of the subcategory.
    const cat = imodel1.elements.getElement((subCat as SubCategory).getCategoryId());
    assert.isTrue(cat instanceof Category);
    if (cat instanceof Category) {
      assert.equal(Id64.getLocalId(cat.id), 45);
      assert.equal(Id64.getBriefcaseId(cat.id), 0);
      assert.isTrue(cat.description === "Legends, symbols keys");
      assert.equal(Id64.getLocalId(cat.code.spec), 22);
      assert.equal(Id64.getBriefcaseId(cat.code.spec), 0);
      assert.isTrue(cat.code.value === "A-Z013-G-Legn");
      testCopyAndJson(cat);
    }

    const phys = imodel1.elements.getElement("0x38");
    assert.isTrue(phys instanceof GeometricElement3d);

    const locateMsg = phys.getToolTipMessage();
    assert.isDefined(locateMsg);

    const a2 = imodel2.elements.getElement("0x1d");
    assert.exists(a2);
    assert.isTrue(a2.federationGuid! === "18eb4650-b074-414f-b961-d9cfaa6c8746");
    const el3: Element = imodel2.elements.getElement(a2.federationGuid!);
    assert.exists(el3);
    assert.notEqual(a2, el3);
    assert.equal(a2.id, el3.id);
    testCopyAndJson(el3);

    const newEl = el3;
    newEl.federationGuid = undefined;
    const newId: Id64String = imodel2.elements.insertElement(newEl);
    assert.isTrue(Id64.isValidId64(newId), "insert worked");
  });

  it("should create elements", () => {
    const seedElement = imodel2.elements.getElement("0x1d");
    assert.exists(seedElement);
    assert.isTrue(seedElement.federationGuid! === "18eb4650-b074-414f-b961-d9cfaa6c8746");

    for (let i = 0; i < 25; i++) {
      const elementProps: GeometricElementProps = {
        classFullName: "Generic:PhysicalObject",
        iModel: imodel2,
        model: seedElement.model,
        category: seedElement.category,
        code: Code.createEmpty(),
        federationGuid: Guid.createValue(),
        userLabel: "UserLabel-" + i,
      };

      const element: Element = imodel2.elements.createElement(elementProps);
      element.setUserProperties("performanceTest", { s: "String-" + i, n: i });

      const elementId: Id64String = imodel2.elements.insertElement(element);
      assert.isTrue(Id64.isValidId64(elementId));
    }
  });

  it("should insert a Texture", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    // This is an encoded png containing a 3x3 square with white in top left pixel, blue in middle pixel, and green in
    // bottom right pixel.  The rest of the square is red.
    const pngData = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 3, 8, 2, 0, 0, 0, 217, 74, 34, 232, 0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0, 14, 195, 1, 199, 111, 168, 100, 0, 0, 0, 24, 73, 68, 65, 84, 24, 87, 99, 248, 15, 4, 12, 12, 64, 4, 198, 64, 46, 132, 5, 162, 254, 51, 0, 0, 195, 90, 10, 246, 127, 175, 154, 145, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

    const testTextureName = "fake texture name";
    const testTextureFormat = ImageSourceFormat.Png;
    const testTextureData = Base64.btoa(String.fromCharCode(...pngData));
    const testTextureWidth = 3;
    const testTextureHeight = 3;
    const testTextureDescription = "empty description";
    const testTextureFlags = TextureFlags.None;

    const textureId = Texture.insert(imodel2, IModel.dictionaryId, testTextureName, testTextureFormat, testTextureData, testTextureWidth, testTextureHeight, testTextureDescription, testTextureFlags);

    const texture = imodel2.elements.getElement<Texture>(textureId);
    assert((texture instanceof Texture) === true, "did not retrieve an instance of Texture");
    expect(texture.format).to.equal(testTextureFormat);
    expect(texture.data).to.equal(testTextureData);
    expect(texture.width).to.equal(testTextureWidth);
    expect(texture.height).to.equal(testTextureHeight);
    expect(texture.description).to.equal(testTextureDescription);
    expect(texture.flags).to.equal(testTextureFlags);
  });

  it("should insert a RenderMaterial", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    const testMaterialName = "test material name";
    const testPaletteName = "test palette name";
    const testDescription = "test description";
    const color = [25, 32, 9];
    const specularColor = [99, 255, 1];
    const finish = 0.4;
    const transmit = 0.1;
    const diffuse = 0.24;
    const specular = 0.9;
    const reflect = 0.3;
    const reflectColor = [255, 0, 127];
    const textureMapProps: TextureMapProps = {
      pattern_angle: 3.0,
      pattern_u_flip: false,
      pattern_flip: false,
      pattern_scale: [1.0, 1.0],
      pattern_offset: [0.0, 0.0],
      pattern_scalemode: TextureMapUnits.Inches,
      pattern_mapping: TextureMapping.Mode.Planar,
      pattern_weight: 0.5,
      TextureId: "test_textureid",
    };

    const renderMaterialParams = new RenderMaterialElement.Params(testPaletteName);
    renderMaterialParams.description = testDescription;
    renderMaterialParams.color = color;
    renderMaterialParams.specularColor = specularColor;
    renderMaterialParams.finish = finish;
    renderMaterialParams.transmit = transmit;
    renderMaterialParams.diffuse = diffuse;
    renderMaterialParams.specular = specular;
    renderMaterialParams.reflect = reflect;
    renderMaterialParams.reflectColor = reflectColor;
    renderMaterialParams.patternMap = textureMapProps;
    const renderMaterialId = RenderMaterialElement.insert(imodel2, IModel.dictionaryId, testMaterialName, renderMaterialParams);

    const renderMaterial = imodel2.elements.getElement<RenderMaterialElement>(renderMaterialId);
    assert((renderMaterial instanceof RenderMaterialElement) === true, "did not retrieve an instance of RenderMaterial");
    expect(renderMaterial.paletteName).to.equal(testPaletteName);
    expect(renderMaterial.description).to.equal(testDescription);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasBaseColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.color)).to.equal(JSON.stringify(color));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasSpecularColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.specular_color)).to.equal(JSON.stringify(specularColor));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasFinish).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.finish).to.equal(finish);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasTransmit).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.transmit).to.equal(transmit);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasDiffuse).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.diffuse).to.equal(diffuse);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasSpecular).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.specular).to.equal(specular);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasReflect).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.reflect).to.equal(reflect);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasReflectColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.reflect_color)).to.equal(JSON.stringify(reflectColor));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.Map).not.to.be.undefined;

    const patternMap = renderMaterial.jsonProperties.materialAssets.renderMaterial.Map.Pattern;
    expect(patternMap).not.to.be.undefined;
    expect(patternMap.pattern_angle).to.equal(textureMapProps.pattern_angle);
    expect(patternMap.pattern_u_flip).to.equal(textureMapProps.pattern_u_flip);
    expect(patternMap.pattern_flip).to.equal(textureMapProps.pattern_flip);
    expect(JSON.stringify(patternMap.pattern_scale)).to.equal(JSON.stringify(textureMapProps.pattern_scale));
    expect(JSON.stringify(patternMap.pattern_offset)).to.equal(JSON.stringify(textureMapProps.pattern_offset));
    expect(patternMap.pattern_scalemode).to.equal(textureMapProps.pattern_scalemode);
    expect(patternMap.pattern_mapping).to.equal(textureMapProps.pattern_mapping);
    expect(patternMap.pattern_weight).to.equal(textureMapProps.pattern_weight);
    expect(patternMap.TextureId).to.equal(textureMapProps.TextureId);
  });

  it.skip("attempt to apply material to new element in imodel5", () => {
    // This is an encoded png containing a 3x3 square with white in top left pixel, blue in middle pixel, and green in
    // bottom right pixel.  The rest of the square is red.
    const pngData = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 3, 8, 2, 0, 0, 0, 217, 74, 34, 232, 0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0, 14, 195, 1, 199, 111, 168, 100, 0, 0, 0, 24, 73, 68, 65, 84, 24, 87, 99, 248, 15, 4, 12, 12, 64, 4, 198, 64, 46, 132, 5, 162, 254, 51, 0, 0, 195, 90, 10, 246, 127, 175, 154, 145, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

    const testTextureName = "fake texture name";
    const testTextureFormat = ImageSourceFormat.Png;
    const testTextureData = Base64.btoa(String.fromCharCode(...pngData));
    const testTextureWidth = 3;
    const testTextureHeight = 3;
    const testTextureDescription = "empty description";
    const testTextureFlags = TextureFlags.None;

    const texId = Texture.insert(imodel5, IModel.dictionaryId, testTextureName, testTextureFormat, testTextureData, testTextureWidth, testTextureHeight, testTextureDescription, testTextureFlags);

    const matId = RenderMaterialElement.insert(imodel5, IModel.dictionaryId, "test material name",
      {
        paletteName: "TestPaletteName",
        patternMap: {
          TextureId: texId,
          pattern_offset: [0, 0],
          pattern_scale: [1, 1],
          pattern_scalemode: TextureMapUnits.Relative,
        },
      });

    /** Create a simple flat mesh with 4 points (2x2) */
    const width = imodel5.projectExtents.xLength() * 0.2;
    const height = imodel5.projectExtents.yLength() * 0.2;
    let shape: GeometryQuery;
    const doPolyface = true;
    if (doPolyface) {
      const options = StrokeOptions.createForFacets();
      options.shouldTriangulate = false;
      const builder = PolyfaceBuilder.create(options);

      const quad = [
        Point3d.create(0.0, 0.0, 0.0),
        Point3d.create(width, 0.0, 0.0),
        Point3d.create(width, height, 0.0),
        Point3d.create(0.0, height, 0.0),
      ];

      builder.addQuadFacet(quad);
      shape = builder.claimPolyface();
    } else {
      shape = Loop.create(LineString3d.create([
        Point3d.create(0, 0, 0),
        Point3d.create(width, 0, 0),
        Point3d.create(width, height, 0),
        Point3d.create(0, height, 0),
        Point3d.create(0, 0, 0),
      ]));
    }

    const modelId = PhysicalModel.insert(imodel5, IModelDb.rootSubjectId, "test_render_material_model_name");

    const categoryId = SpatialCategory.insert(imodel5, IModel.dictionaryId, "GeoJSON Feature", { color: ColorDef.white });

    /** generate a geometry stream containing the polyface */
    const gsBuilder = new GeometryStreamBuilder();
    const params = new GeometryParams(categoryId);
    params.materialId = matId;
    gsBuilder.appendGeometryParamsChange(params);
    gsBuilder.appendGeometry(shape);
    const geometry = gsBuilder.geometryStream;
    // geometry[0].material = { materialId: matId };

    /** The [[GeometricElement3dProps]]  */
    const props: GeometricElement3dProps = {
      placement: { origin: imodel5.projectExtents.center, angles: new YawPitchRollAngles() },
      model: modelId,
      code: Code.createEmpty(),
      classFullName: "Generic:PhysicalObject",
      category: categoryId,
      geom: geometry,
    };
    imodel5.elements.insertElement(props);
    imodel5.saveChanges();
  });

  it("should insert a DisplayStyle", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    const settings: DisplayStyleSettingsProps = {
      backgroundColor: ColorDef.blue,
      viewflags: ViewFlags.fromJSON({
        renderMode: RenderMode.SolidFill,
      }),
    };

    const props: DisplayStyleProps = {
      classFullName: DisplayStyle3d.classFullName,
      model: IModel.dictionaryId,
      code: { spec: BisCodeSpec.displayStyle, scope: IModel.dictionaryId },
      isPrivate: false,
      jsonProperties: {
        styles: settings,
      },
    };

    const styleId = imodel2.elements.insertElement(props);
    let style = imodel2.elements.getElement<DisplayStyle3d>(styleId);
    expect(style instanceof DisplayStyle3d).to.be.true;

    expect(style.settings.viewFlags.renderMode).to.equal(RenderMode.SolidFill);
    expect(style.settings.backgroundColor.equals(ColorDef.blue)).to.be.true;

    const newFlags = style.settings.viewFlags.clone();
    newFlags.renderMode = RenderMode.SmoothShade;
    style.settings.viewFlags = newFlags;
    style.settings.backgroundColor = ColorDef.red;
    style.settings.monochromeColor = ColorDef.green;
    expect(style.jsonProperties.styles.viewflags.renderMode).to.equal(RenderMode.SmoothShade);

    imodel2.elements.updateElement(style.toJSON());
    style = imodel2.elements.getElement<DisplayStyle3d>(styleId);
    expect(style instanceof DisplayStyle3d).to.be.true;

    expect(style.settings.viewFlags.renderMode).to.equal(RenderMode.SmoothShade);
    expect(style.settings.backgroundColor.equals(ColorDef.red)).to.be.true;
    expect(style.settings.monochromeColor.equals(ColorDef.green)).to.be.true;
  });

  it("should have a valid root subject element", () => {
    const rootSubject = imodel1.elements.getRootSubject();
    assert.exists(rootSubject);
    assert.isTrue(rootSubject instanceof Subject);
    assert.isAtLeast(rootSubject.code.getValue().length, 1);

    try {
      imodel1.models.getSubModel(rootSubject.id); // throws error
      assert.fail(); // this line should be skipped
    } catch (error) {
      assert.isTrue(error instanceof Error);
      assert.isTrue(error instanceof IModelError);
      assert.equal(error.errorNumber, IModelStatus.NotFound);
    }

    const childIds: Id64String[] = imodel1.elements.queryChildren(rootSubject.id);
    assert.isAtLeast(childIds.length, 1);
    for (const childId of childIds) {
      const childElement = imodel1.elements.getElement(childId);
      assert.exists(childElement);
      assert.isTrue(childElement instanceof Element);

      testCopyAndJson(childElement);
      assert.equal(rootSubject.id, childElement.parent!.id);

      const childLocalId = Id64.getLocalId(childId);
      const childBcId = Id64.getBriefcaseId(childId);
      if (childElement instanceof InformationPartitionElement) {
        const childSubModel: Model = imodel1.models.getSubModel(childElement.id);
        assert.exists(childSubModel, "InformationPartitionElements should have a subModel");

        if (childLocalId === 16 && childBcId === 0) {
          assert.isTrue(childElement instanceof DefinitionPartition, "ChildId 0x00000010 should be a DefinitionPartition");
          assert.isTrue(childElement.code.value === "BisCore.DictionaryModel", "Definition Partition should have code value of BisCore.DictionaryModel");
        } else if (childLocalId === 14 && childBcId === 0) {
          assert.isTrue(childElement instanceof LinkPartition);
          assert.isTrue(childElement.code.value === "BisCore.RealityDataSources");
        } else if (childLocalId === 17 && childBcId === 0) {
          assert.isTrue(childElement instanceof LinkPartition, "ChildId 0x000000011 should be a LinkPartition");
          assert.isTrue(childElement.code.value === "Repository Links");
        }
      } else if (childElement instanceof Subject) {
        if (childLocalId === 19 && childBcId === 0) {
          assert.isTrue(childElement instanceof Subject);
          assert.isTrue(childElement.code.value === "DgnV8:mf3, A", "Subject should have code value of DgnV8:mf3, A");
          assert.isTrue(childElement.jsonProperties.Subject.Job.DgnV8.V8File === "mf3.dgn", "Subject should have jsonProperty Subject.Job.DgnV.V8File");
          assert.isTrue(childElement.jsonProperties.Subject.Job.DgnV8.V8RootModel === "A", "Subject should have jsonProperty Subject.Job.DgnV.V8RootModel");
        }
      }
    }
  });

  it("should load a known model by Id from an existing iModel", () => {
    assert.exists(imodel1.models);
    const model2 = imodel1.models.getModel("0x1c");
    assert.exists(model2);
    const formatter = model2.getJsonProperty("formatter");
    assert.exists(formatter, "formatter should exist as json property");
    assert.equal(formatter.fmtFlags.angMode, 1, "fmtFlags");
    assert.equal(formatter.mastUnit.label, "m", "mastUnit is meters");
    testCopyAndJson(model2);
    let model = imodel1.models.getModel(IModel.repositoryModelId);
    assert.exists(model);
    testCopyAndJson(model!);
    const code1 = new Code({ spec: "0x1d", scope: "0x1d", value: "A" });
    model = imodel1.models.getSubModel(code1);
    // By this point, we expect the submodel's class to be in the class registry *cache*
    const geomModel = ClassRegistry.getClass(PhysicalModel.classFullName, imodel1);
    assert.exists(model);
    assert.isTrue(model instanceof geomModel!);
    testCopyAndJson(model!);
    const modelExtents: AxisAlignedBox3d = model.queryExtents();
    assert.isBelow(modelExtents.low.x, modelExtents.high.x);
    assert.isBelow(modelExtents.low.y, modelExtents.high.y);
    assert.isBelow(modelExtents.low.z, modelExtents.high.z);
  });

  it("should find a tile tree for a geometric model", async () => {
    // Note: this is an empty model.
    const requestContext2 = new BackendRequestContext();
    const tree = await imodel1.tiles.requestTileTreeProps(requestContext2, "0x1c");
    expect(tree).not.to.be.undefined;

    expect(tree.id).to.equal("0x1c");
    expect(tree.maxTilesToSkip).to.equal(1);
    expect(tree.rootTile).not.to.be.undefined;

    // Empty model => identity transform
    const tf = Transform.fromJSON(tree.location);
    expect(tf.matrix.isIdentity).to.be.true;
    expect(tf.origin.x).to.equal(0);
    expect(tf.origin.y).to.equal(0);
    expect(tf.origin.z).to.equal(0);

    expect(tree.rootTile.contentId).to.equal("0/0/0/0/1");

    // Empty model => null range
    const range = Range3d.fromJSON(tree.rootTile.range);
    expect(range.isNull).to.be.true;

    expect(tree.rootTile.maximumSize).to.equal(0.0); // empty model => undisplayable root tile => size = 0.0
    expect(tree.rootTile.isLeaf).to.be.true; // empty model => empty tile
    expect(tree.rootTile.contentRange).to.be.undefined;
  });

  it("should throw on invalid tile requests", async () => {
    const requestContext2 = new ClientRequestContext("invalidTileRequests");
    await using(new DisableNativeAssertions(), async (_r) => {
      let error = await getIModelError(imodel1.tiles.requestTileTreeProps(requestContext2, "0x12345"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileTreeProps(requestContext2, "NotAValidId"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "0/0/0/0"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x12345", "0/0/0/0/1"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "V/W/X/Y/Z"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "NotAValidId"));
      expectIModelError(IModelStatus.InvalidId, error);
    });
  });

  it("should produce an array of rows", () => {
    const rows: any[] = imodel1.executeQuery(`SELECT * FROM ${Category.classFullName}`);
    assert.exists(rows);
    assert.isArray(rows);
    assert.isAtLeast(rows.length, 1);
    assert.exists(rows[0].id);
    assert.notEqual(rows[0].id.value, "");
  });

  it("should be some categories", () => {
    const categoryRows: any[] = imodel1.executeQuery(`SELECT ECInstanceId FROM ${Category.classFullName}`);
    assert.exists(categoryRows, "Should have some Category ids");
    for (const categoryRow of categoryRows!) {
      const categoryId = Id64.fromJSON(categoryRow.id);
      const category = imodel1.elements.getElement(categoryId);
      assert.isTrue(category instanceof Category, "Should be instance of Category");
      if (!category)
        continue;
      if (!(category instanceof Category))
        continue;

      // verify the default subcategory.
      const defaultSubCategoryId: Id64String = category.myDefaultSubCategoryId();
      const defaultSubCategory = imodel1.elements.getElement(defaultSubCategoryId);
      assert.isTrue(defaultSubCategory instanceof SubCategory, "defaultSubCategory should be instance of SubCategory");
      if (defaultSubCategory instanceof SubCategory) {
        assert.isTrue(defaultSubCategory.parent!.id === categoryId, "defaultSubCategory id should be prescribed value");
        assert.isTrue(defaultSubCategory.getSubCategoryName() === category.code.getValue(), "DefaultSubcategory name should match that of Category");
        assert.isTrue(defaultSubCategory.isDefaultSubCategory, "isDefaultSubCategory should return true");
      }

      // get the subcategories
      const queryString: string = `SELECT ECInstanceId FROM ${SubCategory.classFullName} WHERE Parent.Id=?`;
      const subCategoryRows: any[] = imodel1.executeQuery(queryString, [categoryId]);
      assert.exists(subCategoryRows, "Should have at least one SubCategory");
      for (const subCategoryRow of subCategoryRows) {
        const subCategoryId = Id64.fromJSON(subCategoryRow.id);
        const subCategory = imodel1.elements.getElement(subCategoryId);
        assert.isTrue(subCategory instanceof SubCategory);
        if (subCategory instanceof SubCategory) {
          assert.isTrue(subCategory.parent!.id === categoryId);
        }
      }
    }
  });

  it("should be some 2d elements", () => {
    const drawingGraphicRows: any[] = imodel2.executeQuery("SELECT ECInstanceId FROM BisCore.DrawingGraphic");
    assert.exists(drawingGraphicRows, "Should have some Drawing Graphics");
    for (const drawingGraphicRow of drawingGraphicRows!) {
      const drawingGraphic = imodel2.elements.getElement({ id: drawingGraphicRow.id, wantGeometry: true });
      assert.exists(drawingGraphic);
      assert.isTrue(drawingGraphic.className === "DrawingGraphic", "Should be instance of DrawingGraphic");
      assert.isTrue(drawingGraphic instanceof GeometricElement2d, "Is instance of GeometricElement2d");
      if (Id64.getLocalId(drawingGraphic.id) === 0x25) {
        assert.isTrue(drawingGraphic.placement.origin.x === 0.0);
        assert.isTrue(drawingGraphic.placement.origin.y === 0.0);
        assert.isTrue(drawingGraphic.placement.angle.radians === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.low.x === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.low.y === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.high.x === 1.0);
        assert.isTrue(drawingGraphic.placement.bbox.high.y === 1.0);
        assert.isDefined(drawingGraphic.geom);
      }
      if (Id64.getLocalId(drawingGraphic.id) === 0x26) {
        assert.isTrue(drawingGraphic.placement.origin.x === 1.0);
        assert.isTrue(drawingGraphic.placement.origin.y === 1.0);
        assert.isTrue(drawingGraphic.placement.angle.radians === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.low.x === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.low.y === 0.0);
        assert.isTrue(drawingGraphic.placement.bbox.high.x === 2.0);
        assert.isTrue(drawingGraphic.placement.bbox.high.y === 2.0);
        assert.isDefined(drawingGraphic.geom);
      }
    }
  });

  it("should be able to query for ViewDefinitionProps", () => {
    let viewDefinitionProps: ViewDefinitionProps[] = imodel2.views.queryViewDefinitionProps(); // query for all ViewDefinitions
    assert.isAtLeast(viewDefinitionProps.length, 3);
    assert.isTrue(viewDefinitionProps[0].classFullName.includes("ViewDefinition"));
    assert.isFalse(viewDefinitionProps[1].isPrivate);
    viewDefinitionProps = imodel2.views.queryViewDefinitionProps("BisCore.SpatialViewDefinition"); // limit query to SpatialViewDefinitions
    assert.isAtLeast(viewDefinitionProps.length, 3);
    assert.exists(viewDefinitionProps[2].modelSelectorId);
  });

  it("should iterate ViewDefinitions", () => {
    // imodel2 contains 3 SpatialViewDefinitions and no other views.
    let numViews = 0;
    let result = imodel2.views.iterateViews(IModelDb.Views.defaultQueryParams, (_view: ViewDefinition) => { ++numViews; return true; });
    expect(result).to.be.true;
    expect(numViews).to.equal(3);

    // Query specifically for spatial views
    numViews = 0;
    result = imodel2.views.iterateViews({ from: "BisCore.SpatialViewDefinition" }, (view: ViewDefinition) => {
      if (view.isSpatialView())
        ++numViews;

      return view.isSpatialView();
    });
    expect(result).to.be.true;
    expect(numViews).to.equal(3);

    // Query specifically for 2d views
    numViews = 0;
    result = imodel2.views.iterateViews({ from: "BisCore.ViewDefinition2d" }, (_view: ViewDefinition) => { ++numViews; return true; });
    expect(result).to.be.true;
    expect(numViews).to.equal(0);

    // Terminate iteration on first view
    numViews = 0;
    result = imodel2.views.iterateViews(IModelDb.Views.defaultQueryParams, (_view: ViewDefinition) => { ++numViews; return false; });
    expect(result).to.be.false;
    expect(numViews).to.equal(1);
  });

  it("should be children of RootSubject", () => {
    const queryString: string = `SELECT ECInstanceId FROM ${Model.classFullName} WHERE ParentModel.Id=${IModel.repositoryModelId}`;
    const modelRows: any[] = imodel2.executeQuery(queryString);
    assert.exists(modelRows, "Should have at least one model within rootSubject");
    for (const modelRow of modelRows) {
      const modelId = Id64.fromJSON(modelRow.id);
      const model = imodel2.models.getModel(modelId);
      assert.exists(model, "Model should exist");
      assert.isTrue(model instanceof Model);

      // should be an element with the same Id.
      const modeledElement = imodel2.elements.getElement(modelId);
      assert.exists(modeledElement, "Modeled Element should exist");

      if (model.className === "LinkModel") {
        // expect LinkModel to be accompanied by LinkPartition
        assert.isTrue(modeledElement instanceof LinkPartition);
        continue;
      } else if (model.className === "DictionaryModel") {
        assert.isTrue(modeledElement instanceof DefinitionPartition);
        continue;
      } else if (model.className === "PhysicalModel") {
        assert.isTrue(modeledElement instanceof PhysicalPartition);
        continue;
      } else if (model.className === "GroupModel") {
        assert.isTrue(modeledElement instanceof GroupInformationPartition);
        continue;
      } else if (model.className === "DocumentListModel") {
        assert.isTrue(modeledElement instanceof DocumentPartition);
        continue;
      } else if (model.className === "DefinitionModel") {
        assert.isTrue(modeledElement instanceof DefinitionPartition);
        continue;
      } else {
        assert.isTrue(false, "Expected a known model type");
      }
    }
  });

  it("should produce an array of rows with executeQuery", () => {
    const rows: any[] = imodel1.executeQuery("SELECT * FROM bis.Element");
    assert.exists(rows);
    assert.isArray(rows);
    assert.notEqual(rows.length, 0);
    assert.notEqual(rows[0].id, "");
  });

  it("should insert and update auto-handled properties", () => {
    const testElem = imodel4.elements.getElement("0x14");
    assert.isDefined(testElem);
    assert.equal(testElem.classFullName, "DgnPlatformTest:TestElementWithNoHandler");
    assert.isUndefined(testElem.integerProperty1);

    const newTestElem = testElem.clone();
    assert.equal(newTestElem.classFullName, testElem.classFullName);
    newTestElem.integerProperty1 = 999;
    assert.isTrue(testElem.arrayOfPoint3d[0].isAlmostEqual(newTestElem.arrayOfPoint3d[0]));

    const loc1 = { street: "Elm Street", city: { name: "Downingtown", state: "PA" } };
    const loc2 = { street: "Oak Street", city: { name: "Downingtown", state: "PA" } };
    const loc3 = { street: "Chestnut Street", city: { name: "Philadelphia", state: "PA" } };
    const arrayOfStructs = [loc2, loc3];
    newTestElem.location = loc1;
    newTestElem.arrayOfStructs = arrayOfStructs;
    newTestElem.dtUtc = new Date("2015-03-25");
    newTestElem.p3d = new Point3d(1, 2, 3);

    const newTestElemId = imodel4.elements.insertElement(newTestElem);

    assert.isTrue(Id64.isValidId64(newTestElemId), "insert worked");

    const newTestElemFetched = imodel4.elements.getElement(newTestElemId);
    assert.isDefined(newTestElemFetched);
    assert.isTrue(newTestElemFetched.id === newTestElemId);
    assert.equal(newTestElemFetched.classFullName, newTestElem.classFullName);
    assert.isDefined(newTestElemFetched.integerProperty1);
    assert.equal(newTestElemFetched.integerProperty1, newTestElem.integerProperty1);
    assert.isTrue(newTestElemFetched.arrayOfPoint3d[0].isAlmostEqual(newTestElem.arrayOfPoint3d[0]));
    assert.deepEqual(newTestElemFetched.location, loc1);
    assert.deepEqual(newTestElem.arrayOfStructs, arrayOfStructs);
    // TODO: getElement must convert date ISO string to Date object    assert.deepEqual(newTestElemFetched.dtUtc, newTestElem.dtUtc);
    assert.deepEqual(newTestElemFetched.dtUtc, newTestElem.dtUtc.toJSON());
    assert.isTrue(newTestElemFetched.p3d.isAlmostEqual(newTestElem.p3d));

    // ----------- updates ----------------
    const wasp3d = newTestElemFetched.p3d;
    const editElem = newTestElemFetched;
    editElem.location = loc2;
    try {
      imodel4.elements.updateElement(editElem);
    } catch (_err) {
      assert.fail("Element.update failed");
    }
    const afterUpdateElemFetched = imodel4.elements.getElement(editElem.id);
    assert.deepEqual(afterUpdateElemFetched.location, loc2, " location property should be the new one");
    assert.deepEqual(afterUpdateElemFetched.id, editElem.id, " the id should not have changed.");
    assert.deepEqual(afterUpdateElemFetched.p3d, wasp3d, " p3d property should not have changed");

    // Make array shorter
    assert.equal(afterUpdateElemFetched.arrayOfInt.length, 300);

    afterUpdateElemFetched.arrayOfInt = [99, 3];
    imodel4.elements.updateElement(afterUpdateElemFetched);

    const afterShortenArray = imodel4.elements.getElement(afterUpdateElemFetched.id);
    assert.equal(afterUpdateElemFetched.arrayOfInt.length, 2);
    assert.deepEqual(afterShortenArray.arrayOfInt, [99, 3]);

    // Make array longer
    afterShortenArray.arrayOfInt = [1, 2, 3];
    imodel4.elements.updateElement(afterShortenArray);
    const afterLengthenArray = imodel4.elements.getElement(afterShortenArray.id);
    assert.equal(afterLengthenArray.arrayOfInt.length, 3);
    assert.deepEqual(afterLengthenArray.arrayOfInt, [1, 2, 3]);

    // ------------ delete -----------------
    const elid = afterUpdateElemFetched.id;
    imodel4.elements.deleteElement(elid);
    try {
      imodel4.elements.getElement(elid);
      assert.fail("should fail to load the element.");
    } catch (error) {
      // TODO: test that error is what I expect assert.equal(error.status == IModelStatus.)
    }
  });

  function checkElementMetaData(obj: EntityMetaData) {
    assert.isNotNull(obj);
    assert.equal(obj.ecclass, Element.classFullName);
    assert.isArray(obj.baseClasses);
    assert.equal(obj.baseClasses.length, 0);

    assert.isArray(obj.customAttributes);
    let foundClassHasHandler = false;
    let foundClassHasCurrentTimeStampProperty = false;
    if (obj.customAttributes !== undefined) {
      for (const ca of obj.customAttributes) {
        if (ca.ecclass === "BisCore:ClassHasHandler")
          foundClassHasHandler = true;
        else if (ca.ecclass === "CoreCustomAttributes:ClassHasCurrentTimeStampProperty")
          foundClassHasCurrentTimeStampProperty = true;
      }
    }
    assert.isTrue(foundClassHasHandler);
    assert.isTrue(foundClassHasCurrentTimeStampProperty);
    assert.isDefined(obj.properties.federationGuid);
    assert.equal(obj.properties.federationGuid.primitiveType, 257);
    assert.equal(obj.properties.federationGuid.extendedType, "BeGuid");
  }

  it("should get metadata for class", () => {
    const metaData: EntityMetaData = imodel1.getMetaData(Element.classFullName);
    assert.exists(metaData);
    checkElementMetaData(metaData);
  });

  it("update the project extents", async () => {
    const originalExtents = imodel1.projectExtents;
    const newExtents = Range3d.create(originalExtents.low, originalExtents.high);
    newExtents.low.x -= 50; newExtents.low.y -= 25; newExtents.low.z -= 189;
    newExtents.high.x += 1087; newExtents.high.y += 19; newExtents.high.z += .001;
    imodel1.updateProjectExtents(newExtents);

    const updatedProps = JSON.parse(imodel1.briefcase!.nativeDb.getIModelProps());
    assert.isTrue(updatedProps.hasOwnProperty("projectExtents"), "Returned property JSON object has project extents");
    const updatedExtents = Range3d.fromJSON(updatedProps.projectExtents);
    assert.isTrue(newExtents.isAlmostEqual(updatedExtents), "Project extents successfully updated in database");
  });

  it("read view thumbnail", () => {
    const viewId = "0x24";
    const thumbnail = imodel5.views.getThumbnail(viewId);
    assert.exists(thumbnail);
    if (!thumbnail)
      return;
    assert.equal(thumbnail.format, "jpeg");
    assert.equal(thumbnail.height, 768);
    assert.equal(thumbnail.width, 768);
    assert.equal(thumbnail.image!.length, 18062);

    thumbnail.width = 100;
    thumbnail.height = 200;
    thumbnail.format = "png";
    thumbnail.image = new Uint8Array(200);
    thumbnail.image.fill(12);
    const stat = imodel5.views.saveThumbnail(viewId, thumbnail);
    assert.equal(stat, 0, "save thumbnail");
    const thumbnail2 = imodel5.views.getThumbnail(viewId);
    assert.exists(thumbnail2);
    if (!thumbnail2)
      return;
    assert.equal(thumbnail2.format, "png");
    assert.equal(thumbnail2.height, 200);
    assert.equal(thumbnail2.width, 100);
    assert.equal(thumbnail2.image!.length, 200);
    assert.equal(thumbnail2.image![0], 12);
  });

  it("ecefLocation for iModels", () => {
    assert.isTrue(imodel5.isGeoLocated);
    const center = { x: 289095, y: 3803860, z: 10 }; // near center of project extents, 10 meters above ground.
    const ecefPt = imodel5.spatialToEcef(center);
    const pt = { x: -3575157.057023252, y: 3873432.7966756118, z: 3578994.5664978377 };
    assert.isTrue(ecefPt.isAlmostEqual(pt), "spatialToEcef");

    const z2 = imodel5.ecefToSpatial(ecefPt);
    assert.isTrue(z2.isAlmostEqual(center), "ecefToSpatial");

    const carto = imodel5.spatialToCartographicFromEcef(center);
    assert.approximately(Angle.radiansToDegrees(carto.longitude), 132.70599650539427, .1); // this data is in Japan
    assert.approximately(Angle.radiansToDegrees(carto.latitude), 34.35461328445589, .1);
    const c2 = { longitude: 2.316156576159219, latitude: 0.5996011150631385, height: 10 };
    assert.isTrue(carto.equalsEpsilon(c2, .001), "spatialToCartographic");

    imodel5.cartographicToSpatialFromEcef(carto, z2);
    assert.isTrue(z2.isAlmostEqual(center, .001), "cartographicToSpatial");
  });

  function checkClassHasHandlerMetaData(obj: EntityMetaData) {
    assert.isDefined(obj.properties.restrictions);
    assert.equal(obj.properties.restrictions.primitiveType, 2305);
    assert.equal(obj.properties.restrictions.minOccurs, 0);
  }

  it("should get metadata for CA class just as well (and we'll see a array-typed property)", () => {
    const metaData: EntityMetaData = imodel1.getMetaData("BisCore:ClassHasHandler");
    assert.exists(metaData);
    checkClassHasHandlerMetaData(metaData);
  });

  it("should get metadata for CA class just as well (and we'll see a array-typed property)", () => {
    const metaData: EntityMetaData = imodel1.getMetaData("BisCore:ClassHasHandler");
    assert.exists(metaData);
    checkClassHasHandlerMetaData(metaData);
  });

  it("should exercise ECSqlStatement (backend only)", () => {
    // Reject an invalid statement
    try {
      imodel2.prepareStatement("select no_such_property, codeValue from bis.element");
      assert.fail("prepare should have failed with an exception");
    } catch (err) {
      assert.isTrue(err.constructor.name === "IModelError");
      assert.notEqual(err.status, DbResult.BE_SQLITE_OK);
    }
    let lastId: string = "";
    let firstCodeValue: string = "";
    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element", (stmt: ECSqlStatement) => {
      assert.isNotNull(stmt);
      // Reject an attempt to bind when there are no placeholders in the statement
      try {
        stmt.bindStruct(1, { foo: 1 });
        assert.fail("bindStruct should have failed with an exception");
      } catch (err2) {
        assert.isTrue(err2.constructor.name === "IModelError");
        assert.notEqual(err2.status, DbResult.BE_SQLITE_OK);
      }

      // Verify that we get a bunch of rows with the expected shape
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt.step()) {
        const row = stmt.getRow();
        assert.isNotNull(row);
        assert.isObject(row);
        assert.isTrue(row.id !== undefined);
        assert.isTrue(Id64.isValid(Id64.fromJSON(row.id)));
        lastId = row.id;
        if (row.codeValue !== undefined)
          firstCodeValue = row.codeValue;
        count = count + 1;
      }
      assert.isTrue(count > 1);
      assert.notEqual(lastId, "");
      assert.notEqual(firstCodeValue, "");

      // Try iterator style
      let firstCodeValueIter: string = "";
      let iteratorCount = 0;
      let lastIterId: string = "";
      stmt.reset();
      for (const row of stmt) {
        assert.isNotNull(row);
        assert.isObject(row);
        assert.isTrue(row.id !== undefined);
        assert.isTrue(Id64.isValid(Id64.fromJSON(row.id)));
        lastIterId = row.id;
        iteratorCount = iteratorCount + 1;
        if (row.codeValue !== undefined)
          firstCodeValueIter = row.codeValue;
      }
      assert.equal(iteratorCount, count, "iterator loop should find the same number of rows as the step loop");
      assert.equal(lastIterId, lastId, "iterator loop should see the same last row as the step loop");
      assert.equal(firstCodeValueIter, firstCodeValue, "iterator loop should find the first non-null code value as the step loop");
    });

    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element WHERE (ecinstanceid=?)", (stmt3: ECSqlStatement) => {
      // Now try a statement with a placeholder
      const idToFind: Id64String = Id64.fromJSON(lastId);
      stmt3.bindId(1, idToFind);
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt3.step()) {
        count = count + 1;
        const row = stmt3.getRow();
        // Verify that we got the row that we asked for
        assert.isTrue(idToFind === Id64.fromJSON(row.id));
      }
      // Verify that we got the row that we asked for
      assert.equal(count, 1);
    });

    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element WHERE (codeValue = :codevalue)", (stmt4: ECSqlStatement) => {
      // Try a named placeholder
      const codeValueToFind = firstCodeValue;
      stmt4.bindString("codeValue", codeValueToFind);
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt4.step()) {
        count = count + 1;
        const row = stmt4.getRow();
        // Verify that we got the row that we asked for
        assert.equal(row.codeValue, codeValueToFind);
      }
      // Verify that we got the row that we asked for
      assert.equal(count, 1);
    });

    imodel2.withPreparedStatement("select ecinstanceid as id, codevalue from bis.element", (stmt5: ECSqlStatement) => {
      while (DbResult.BE_SQLITE_ROW === stmt5.step()) {
        imodel2.withPreparedStatement("select codevalue from bis.element where ecinstanceid=?", (stmt6: ECSqlStatement) => {
          stmt6.bindId(1, stmt5.getRow().id);
          while (DbResult.BE_SQLITE_ROW === stmt6.step()) {
            assert.equal(stmt6.getRow().codevalue, stmt5.getRow().codevalue);
          }
        });
      }
    });

  });

  it("should create and insert CodeSpecs", () => {
    const testImodel = imodel2;

    const codeSpec: CodeSpec = new CodeSpec(testImodel, Id64.invalid, "CodeSpec1", CodeScopeSpec.Type.Model);
    const codeSpecId: Id64String = testImodel.codeSpecs.insert(codeSpec); // throws in case of error
    assert.deepEqual(codeSpecId, codeSpec.id);
    assert.equal(codeSpec.specScopeType, CodeScopeSpec.Type.Model);
    assert.equal(codeSpec.scopeReq, CodeScopeSpec.ScopeRequirement.ElementId);

    // Should not be able to insert a duplicate.
    try {
      const codeSpecDup: CodeSpec = new CodeSpec(testImodel, Id64.invalid, "CodeSpec1", CodeScopeSpec.Type.Model);
      testImodel.codeSpecs.insert(codeSpecDup); // throws in case of error
      assert.fail();
    } catch (err) {
      // We expect this to fail.
    }

    // We should be able to insert another CodeSpec with a different name.
    const codeSpec2: CodeSpec = new CodeSpec(testImodel, Id64.invalid, "CodeSpec2", CodeScopeSpec.Type.Model, CodeScopeSpec.ScopeRequirement.FederationGuid);
    const codeSpec2Id: Id64String = testImodel.codeSpecs.insert(codeSpec2); // throws in case of error
    assert.deepEqual(codeSpec2Id, codeSpec2.id);

    assert.notDeepEqual(codeSpec2Id, codeSpecId);

    // make sure CodeScopeSpec.Type.Repository works
    const codeSpec3: CodeSpec = new CodeSpec(testImodel, Id64.invalid, "CodeSpec3", CodeScopeSpec.Type.Repository, CodeScopeSpec.ScopeRequirement.FederationGuid);
    const codeSpec3Id: Id64String = testImodel.codeSpecs.insert(codeSpec3); // throws in case of error
    assert.notDeepEqual(codeSpec2Id, codeSpec3Id);

    const codeSpec4: CodeSpec = testImodel.codeSpecs.getById(codeSpec3Id);
    codeSpec4.name = "CodeSpec4";
    const codeSpec4Id: Id64String = testImodel.codeSpecs.insert(codeSpec4); // throws in case of error
    assert.notDeepEqual(codeSpec3Id, codeSpec4Id);
    assert.equal(codeSpec4.specScopeType, CodeScopeSpec.Type.Repository);
    assert.equal(codeSpec4.scopeReq, CodeScopeSpec.ScopeRequirement.FederationGuid);

    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec1"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec2"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec3"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec4"));
    assert.isFalse(testImodel.codeSpecs.hasName("CodeSpec5"));

    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec2.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec3.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec4.id));
    assert.isFalse(testImodel.codeSpecs.hasId(Id64.invalid));
  });

  it("snapping", async () => {
    const worldToView = Matrix4d.createIdentity();
    const response = await imodel2.requestSnap(requestContext, "0x222", { testPoint: { x: 1, y: 2, z: 3 }, closePoint: { x: 1, y: 2, z: 3 }, id: "0x111", worldToView: worldToView.toJSON() });
    assert.isDefined(response.status);
  });

  it("should import schemas", async () => {
    const classMetaData = imodel1.getMetaData("TestBim:TestDocument"); // will throw on failure
    assert.isDefined(classMetaData.properties.testDocumentProperty);
    assert.isTrue(classMetaData.properties.testDocumentProperty.primitiveType === PrimitiveTypeCode.Integer);
  });

  it("should do CRUD on models", () => {

    const testImodel = imodel2;

    let modeledElementId: Id64String;
    let newModelId: Id64String;
    [modeledElementId, newModelId] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty(), true);

    const newModelPersist = testImodel.models.getModel(newModelId);

    // Check that it has the properties that we set.
    assert.equal(newModelPersist.classFullName, PhysicalModel.classFullName);
    assert.isTrue(newModelPersist.isPrivate);
    assert.deepEqual(newModelPersist.modeledElement.id, modeledElementId);

    // Update the model
    newModelPersist.isPrivate = false;
    testImodel.models.updateModel(newModelPersist);
    //  ... and check that it updated the model in the db
    const newModelPersist2 = testImodel.models.getModel(newModelId);
    assert.isFalse(newModelPersist2.isPrivate);

    // Delete the model
    testImodel.models.deleteModel(newModelId);
  });

  it("should create model with custom relationship to modeled element", async () => {
    const testImodel = imodel1;

    assert.isDefined(testImodel.getMetaData("TestBim:TestModelModelsElement"), "TestModelModelsElement is expected to be defined in TestBim.ecschema.xml");

    let newModelId1: Id64String;
    let newModelId2: Id64String;
    let relClassName1: string | undefined;
    let relClassName2: string | undefined;

    if (true) {
      const newPartition1 = IModelTestUtils.createAndInsertPhysicalPartition(testImodel, Code.createEmpty());
      relClassName1 = "TestBim:TestModelModelsElement";
      const modeledElementRef = new RelatedElement({ id: newPartition1, relClassName: relClassName1 });
      newModelId1 = IModelTestUtils.createAndInsertPhysicalModel(testImodel, modeledElementRef);
      assert.isTrue(Id64.isValidId64(newModelId1));
    }

    if (true) {
      [, newModelId2] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty());
      const newModel2 = testImodel.models.getModel(newModelId2);
      relClassName2 = newModel2.modeledElement.relClassName;
    }

    const model1 = testImodel.models.getModel(newModelId1);
    const model2 = testImodel.models.getModel(newModelId2);

    const foundRelClassName1 = model1.modeledElement.relClassName;
    const foundRelClassName2 = model2.modeledElement.relClassName;

    assert.equal(foundRelClassName1, relClassName1);
    assert.equal(foundRelClassName2, relClassName2);
  });

  it("should create link table relationship instances", () => {
    const testImodel = imodel1;
    const elements = testImodel.elements;

    testImodel.nativeDb.enableTxnTesting();

    // Create a new physical model
    const newModelId = PhysicalModel.insert(testImodel, IModel.rootSubjectId, "TestModel");

    // create a SpatialCategory
    const spatialCategoryId = SpatialCategory.insert(testImodel, IModel.dictionaryId, "MySpatialCategory", new SubCategoryAppearance({ color: ColorByName.darkRed }));

    // Create a couple of physical elements.
    const elementProps: GeometricElementProps = {
      classFullName: PhysicalObject.classFullName,
      iModel: testImodel,
      model: newModelId,
      category: spatialCategoryId,
      code: Code.createEmpty(),
    };

    const id0 = elements.insertElement(elementProps);
    const id1 = elements.insertElement(elementProps);
    const id2 = elements.insertElement(elementProps);

    const geometricModel = testImodel.models.getModel<GeometricModel>(newModelId);
    assert.throws(() => geometricModel.queryExtents()); // no geometry

    // Create grouping relationships from 0 to 1 and from 0 to 2
    const r1 = ElementGroupsMembers.create(testImodel, id0, id1, 1);
    r1.insert();
    const r2 = ElementGroupsMembers.create(testImodel, id0, id2);
    r2.insert();

    // Look up by id
    const g1 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r1.id);
    const g2 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r2.id);

    assert.deepEqual(g1.id, r1.id);
    assert.equal(g1.classFullName, ElementGroupsMembers.classFullName);
    assert.equal(g1.memberPriority, 1, "g1.memberPriority");
    assert.deepEqual(g2.id, r2.id);
    assert.equal(g2.classFullName, ElementGroupsMembers.classFullName);
    assert.equal(g2.memberPriority, 0, "g2.memberPriority");  // The memberPriority parameter defaults to 0 in ElementGroupsMembers.create

    // Look up by source and target
    const g1byst = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, { sourceId: r1.sourceId, targetId: r1.targetId });
    assert.deepEqual(g1byst, g1);

    // Update relationship instance property
    r1.memberPriority = 2;
    r1.update();

    const g11 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r1.id);
    assert.equal(g11.memberPriority, 2, "g11.memberPriority");
    testImodel.saveChanges("step 1");

    // Delete relationship instance property
    g11.delete();
    testImodel.saveChanges("step 2");
    assert.throws(() => ElementGroupsMembers.getInstance(testImodel, r1.id), IModelError);

    const d0 = elements.insertElement(elementProps);
    const d1 = elements.insertElement(elementProps);
    const ede1 = ElementDrivesElement.create(testImodel, d0, d1, 0);
    ede1.insert();
    testImodel.saveChanges("step 3");

    ede1.delete();
    testImodel.saveChanges("step 4");

  });

  it("should set EC properties of various types", async () => {

    const testImodel = imodel1;
    testImodel.getMetaData("TestBim:TestPhysicalObject");

    // Create a new physical model
    let newModelId: Id64String;
    [, newModelId] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty(), true);

    // Find or create a SpatialCategory
    let spatialCategoryId = SpatialCategory.queryCategoryIdByName(testImodel, IModel.dictionaryId, "MySpatialCategory");
    if (undefined === spatialCategoryId) {
      spatialCategoryId = SpatialCategory.insert(testImodel, IModel.dictionaryId, "MySpatialCategory", new SubCategoryAppearance());
    }

    const trelClassName = "TestBim:TestPhysicalObjectRelatedToTestPhysicalObject";

    let id1: Id64String;
    let id2: Id64String;

    if (true) {
      // Create a couple of TestPhysicalObjects
      const elementProps: GeometricElementProps = {
        classFullName: "TestBim:TestPhysicalObject",
        iModel: testImodel,
        model: newModelId,
        category: spatialCategoryId,
        code: Code.createEmpty(),
      };

      id1 = testImodel.elements.insertElement(testImodel.elements.createElement(elementProps));
      assert.isTrue(Id64.isValidId64(id1));

      // The second one should point to the first.
      elementProps.id = Id64.invalid;
      elementProps.relatedElement = { id: id1, relClassName: trelClassName };
      elementProps.parent = { id: id1, relClassName: trelClassName };
      elementProps.longProp = 4294967295;     // make sure that we can save values in the range 0 ... UINT_MAX

      id2 = testImodel.elements.insertElement(testImodel.elements.createElement(elementProps));
      assert.isTrue(Id64.isValidId64(id2));
    }

    if (true) {
      // Test that el2 points to el1
      const el2 = testImodel.elements.getElement(id2);
      assert.equal(el2.classFullName, "TestBim:TestPhysicalObject");
      assert.isTrue("relatedElement" in el2);
      assert.isTrue("id" in el2.relatedElement);
      assert.deepEqual(el2.relatedElement.id, id1);
      assert.equal(el2.longProp, 4294967295);

      // Even though I didn't set it, the platform knows the relationship class and reports it.
      assert.isTrue("relClassName" in el2.relatedElement);
      assert.equal(el2.relatedElement.relClassName.replace(".", ":"), trelClassName);
    }

    if (true) {
      // Change el2 to point to itself.
      const el2Modified = testImodel.elements.getElement(id2);
      el2Modified.relatedElement = { id: id2, relClassName: trelClassName };
      testImodel.elements.updateElement(el2Modified);
      // Test that el2 points to itself.
      const el2after: Element = testImodel.elements.getElement(id2);
      assert.deepEqual(el2after.relatedElement.id, id2);
      assert.equal(el2after.relatedElement.relClassName.replace(".", ":"), trelClassName);
    }

    if (true) {
      // Test that we can null out the navigation property
      const el2Modified = testImodel.elements.getElement(id2);
      el2Modified.relatedElement = null;
      testImodel.elements.updateElement(el2Modified);
      // Test that el2 has no relatedElement property value
      const el2after: Element = testImodel.elements.getElement(id2);
      assert.isUndefined(el2after.relatedElement);
    }
  });

  it("should be able to create a snapshot IModel", async () => {
    const args = {
      rootSubject: { name: "TestSubject", description: "test project" },
      client: "ABC Manufacturing",
      globalOrigin: { x: 10, y: 10 },
      projectExtents: { low: { x: -300, y: -300, z: -20 }, high: { x: 500, y: 500, z: 400 } },
      guid: Guid.createValue(),
    };

    const iModel: IModelDb = IModelDb.createSnapshot(IModelTestUtils.prepareOutputFile("IModel", "TestSnapshot.bim"), args);
    assert.equal(iModel.getGuid(), args.guid);
    assert.equal(iModel.rootSubject.name, args.rootSubject.name);
    assert.equal(iModel.rootSubject.description, args.rootSubject.description);
    assert.equal(iModel.projectExtents.low.x, args.projectExtents.low.x);
    assert.equal(iModel.projectExtents.low.y, args.projectExtents.low.y);
    assert.equal(iModel.projectExtents.low.z, args.projectExtents.low.z);
    assert.equal(iModel.globalOrigin.x, args.globalOrigin.x);
    assert.equal(iModel.globalOrigin.y, args.globalOrigin.y);
    assert.equal(iModel.globalOrigin.z, 0);

    const client = iModel.queryFilePropertyString({ name: "Client", namespace: "dgn_Db" });
    assert.equal(client, args.client, "query Client property");

    const dbguid = iModel.queryFilePropertyBlob({ name: "DbGuid", namespace: "be_Db" });
    assert.equal(dbguid!.byteLength, 16, "query guid property");

    const myPropsStr: FilePropertyProps = { name: "MyProp", namespace: "test1", id: 1, subId: 1 };
    const myStrVal = "this is a test";
    let stat = iModel.saveFileProperty(myPropsStr, myStrVal);
    assert.equal(stat, 0, "saveFileProperty as string");
    const readFromDb = iModel.queryFilePropertyString(myPropsStr);
    assert.equal(readFromDb, myStrVal, "query string after save");

    const myPropsBlob: FilePropertyProps = { name: "MyBlob", namespace: "test1", id: 10 };
    const testRange = new Uint8Array(500);
    testRange.fill(11);
    stat = iModel.saveFileProperty(myPropsBlob, undefined, testRange);
    assert.equal(stat, 0, "saveFileProperty as blob");
    const blobFromDb = iModel.queryFilePropertyBlob(myPropsBlob);
    assert.deepEqual(blobFromDb, testRange, "query blob after save");

    let next = iModel.queryNextAvailableFileProperty(myPropsBlob);
    assert.equal(11, next, "queryNextAvailableFileProperty blob");

    next = iModel.queryNextAvailableFileProperty(myPropsStr);
    assert.equal(2, next, "queryNextAvailableFileProperty str");
    assert.equal(0, iModel.deleteFileProperty(myPropsStr), "do deleteFileProperty");
    assert.equal(stat, 0, "deleteFileProperty");
    assert.isUndefined(iModel.queryFilePropertyString(myPropsStr), "property was deleted");
    next = iModel.queryNextAvailableFileProperty(myPropsStr);
    assert.equal(0, next, "queryNextAvailableFileProperty, should return 0 when none present");

    iModel.closeSnapshot();
  });

  it("The same promise can have two subscribers, and it will notify both.", async () => {
    const testPromise = new Promise((resolve, _reject) => {
      setTimeout(() => resolve("Success!"), 250);
    });

    let callbackcount = 0;
    testPromise.then(() => { // tslint:disable-line:no-floating-promises
      ++callbackcount;
    });
    testPromise.then(() => { // tslint:disable-line:no-floating-promises
      ++callbackcount;
    });

    await testPromise;

    assert.equal(callbackcount, 2);
  });

  // This is skipped because it fails unpredictably - the timeouts don't seem to happen as expected
  it.skip("should test AutoPush", async () => {
    let idle: boolean = true;
    const activityMonitor = {
      isIdle: idle,
    };

    const fakePushTimeRequired = 1; // pretend that it takes 1/1000 of a second to do the push
    const millisToWaitForAutoPush = (15 * fakePushTimeRequired); // a long enough wait to ensure that auto-push ran.

    const iModel = {
      pushChanges: async (_clientAccessToken: AccessToken) => {
        await new Promise((resolve, _reject) => { setTimeout(resolve, fakePushTimeRequired); }); // sleep, to simulate time spent doing push
        lastPushTimeMillis = Date.now();
      },
      iModelToken: {
        changeSetId: "",
        iModelId: "fake",
      },
      concurrencyControl: {
        request: async (_clientAccessToken: AccessToken) => { },
      },
      onBeforeClose: new BeEvent<() => void>(),
      txns: {
        hasLocalChanges: () => true,
      },
    };

    const authorizationClient: IAuthorizationClient = {
      getAccessToken: async (_requestContext: ClientRequestContext): Promise<AccessToken> => {
        const fakeAccessToken2 = {} as AccessToken;
        return fakeAccessToken2;
      },
      isAuthorized: true,
      hasExpired: false,
      hasSignedIn: true,
    };

    lastPushTimeMillis = 0;
    lastAutoPushEventType = undefined;

    // Create an autopush in manual-schedule mode.
    const autoPushParams: AutoPushParams = { pushIntervalSecondsMin: 0, pushIntervalSecondsMax: 1, autoSchedule: false };
    IModelHost.authorizationClient = authorizationClient;
    const autoPush = new AutoPush(iModel as any, autoPushParams, activityMonitor);
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to start automatically");
    assert.isFalse(autoPush.autoSchedule);

    // Schedule the next push
    autoPush.scheduleNextPush();
    assert.equal(autoPush.state, AutoPushState.Scheduled);

    // Wait long enough for the auto-push to happen
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); });

    // Verify that push happened during the time that I was asleep.
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to restart automatically");
    assert.notEqual(lastPushTimeMillis, 0);
    assert.isAtLeast(autoPush.durationOfLastPushMillis, fakePushTimeRequired);
    assert.isUndefined(lastAutoPushEventType);  // not listening to events yet.

    // Cancel the next scheduled push
    autoPush.cancel();
    assert.equal(autoPush.state, AutoPushState.NotRunning, "cancel does NOT automatically schedule the next push");

    // Register an event handler
    const autoPushEventHandler: AutoPushEventHandler = (etype: AutoPushEventType, _theAutoPush: AutoPush) => { lastAutoPushEventType = etype; };
    autoPush.event.addListener(autoPushEventHandler);

    lastPushTimeMillis = 0;

    // Explicitly schedule the next auto-push
    autoPush.scheduleNextPush();
    assert.equal(autoPush.state, AutoPushState.Scheduled);

    // wait long enough for the auto-push to happen
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); });
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to start automatically");
    assert.notEqual(lastPushTimeMillis, 0);
    assert.equal(lastAutoPushEventType, AutoPushEventType.PushFinished, "event handler should have been called");

    // Just verify that this doesn't blow up.
    await autoPush.reserveCodes();

    // Now turn on auto-schedule and verify that we get a few auto-pushes
    lastPushTimeMillis = 0;
    autoPush.autoSchedule = true;
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0);
    lastPushTimeMillis = 0;
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0);
    autoPush.cancel();
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert(autoPush.state === AutoPushState.NotRunning);
    assert.isFalse(autoPush.autoSchedule, "cancel turns off autoSchedule");

    // Test auto-push when isIdle returns false
    idle = false;
    lastPushTimeMillis = 0;
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.equal(lastPushTimeMillis, 0); // auto-push should not have run, because isIdle==false.
    assert.equal(autoPush.state, AutoPushState.Scheduled); // Instead, it should have re-scheduled
    autoPush.cancel();
    idle = true;

    // Test auto-push when Txn.hasLocalChanges returns false
    iModel.txns.hasLocalChanges = () => false;
    lastPushTimeMillis = 0;
    autoPush.cancel();
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.equal(lastPushTimeMillis, 0); // auto-push should not have run, because isIdle==false.
    assert.equal(autoPush.state, AutoPushState.Scheduled); // Instead, it should have re-scheduled
    autoPush.cancel();

    // ... now turn it back on
    iModel.txns.hasLocalChanges = () => true;
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0); // AutoPush should have run

    autoPush.cancel();
  });

  it.skip("ImodelJsTest.MeasureInsertPerformance", () => {

    const seedFileName = IModelTestUtils.resolveAssetFile("DgnPlatformSeedManager_OneSpatialModel10.bim");
    const testFileName = IModelTestUtils.prepareOutputFile("IModel", "ImodelJsTest_MeasureInsertPerformance.bim");
    const ifperfimodel = IModelTestUtils.createSnapshotFromSeed(testFileName, seedFileName);

    // tslint:disable-next-line:no-console
    console.time("ImodelJsTest.MeasureInsertPerformance");

    // TODO: Look up model by code (i.e., codevalue of a child of root subject, where child has a PhysicalPartition)
    // const physicalPartitionCode: Code = PhysicalPartition::CreateCode(*m_db->Elements().GetRootSubject(), "DefaultModel");
    // const modelId: Id64String = ifperfimodel.models.querySubModelId(physicalPartitionCode);
    const modelId = Id64.fromString("0X11");

    const defaultCategoryId: Id64String | undefined = SpatialCategory.queryCategoryIdByName(ifperfimodel, IModel.dictionaryId, "DefaultCategory");
    assert.isFalse(undefined === defaultCategoryId);

    const elementCount = 10000;
    for (let i = 0; i < elementCount; ++i) {

      const element: Element = ifperfimodel.elements.createElement({ classFullName: "DgnPlatformTest:ImodelJsTestElement", iModel: ifperfimodel, model: modelId, id: Id64.invalid, code: Code.createEmpty(), category: defaultCategoryId });

      element.integerProperty1 = i;
      element.integerProperty2 = i;
      element.integerProperty3 = i;
      element.integerProperty4 = i;
      element.doubleProperty1 = i;
      element.doubleProperty2 = i;
      element.doubleProperty3 = i;
      element.doubleProperty4 = i;
      element.b = (0 === (i % 100));
      const pt: Point3d = new Point3d(i, 0, 0);
      element.pointProperty1 = pt;
      element.pointProperty2 = pt;
      element.pointProperty3 = pt;
      element.pointProperty4 = pt;
      // const dtUtc: Date = new Date("2013-09-15 12:05:39Z");    // Dates are so expensive to parse in native code that this skews the performance results
      // element.dtUtc = dtUtc;

      const insertedElemId = ifperfimodel.elements.insertElement(element);
      assert.isTrue(Id64.isValidId64(insertedElemId), "insert worked");
      if (0 === (i % 100))
        ifperfimodel.saveChanges();
    }

    ifperfimodel.saveChanges();

    ifperfimodel.withPreparedStatement("select count(*) as [count] from DgnPlatformTest.ImodelJsTestElement", (stmt: ECSqlStatement) => {
      assert.equal(DbResult.BE_SQLITE_ROW, stmt.step());
      const row = stmt.getRow();
      assert.equal(row.count, elementCount);
    });

    // tslint:disable-next-line:no-console
    console.timeEnd("ImodelJsTest.MeasureInsertPerformance");

  });

  it("Run plain SQL", () => {
    imodel1.withPreparedSqliteStatement("CREATE TABLE Test(Id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Code INTEGER)", (stmt: SqliteStatement) => {
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(?,?)", (stmt: SqliteStatement) => {
      stmt.bindValue(1, "Dummy 1");
      stmt.bindValue(2, 100);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(?,?)", (stmt: SqliteStatement) => {
      stmt.bindValues(["Dummy 2", 200]);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(:p1,:p2)", (stmt: SqliteStatement) => {
      stmt.bindValue(":p1", "Dummy 3");
      stmt.bindValue(":p2", 300);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(:p1,:p2)", (stmt: SqliteStatement) => {
      stmt.bindValues({ ":p1": "Dummy 4", ":p2": 400 });
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.saveChanges();

    imodel1.withPreparedSqliteStatement("SELECT Id,Name,Code FROM Test ORDER BY Id", (stmt: SqliteStatement) => {
      for (let i: number = 1; i <= 4; i++) {
        assert.equal(stmt.step(), DbResult.BE_SQLITE_ROW);
        assert.equal(stmt.getColumnCount(), 3);
        const val0: SqliteValue = stmt.getValue(0);
        assert.equal(val0.columnName, "Id");
        assert.equal(val0.type, SqliteValueType.Integer);
        assert.isFalse(val0.isNull);
        assert.equal(val0.getInteger(), i);

        const val1: SqliteValue = stmt.getValue(1);
        assert.equal(val1.columnName, "Name");
        assert.equal(val1.type, SqliteValueType.String);
        assert.isFalse(val1.isNull);
        assert.equal(val1.getString(), `Dummy ${i}`);

        const val2: SqliteValue = stmt.getValue(2);
        assert.equal(val2.columnName, "Code");
        assert.equal(val2.type, SqliteValueType.Integer);
        assert.isFalse(val2.isNull);
        assert.equal(val2.getInteger(), i * 100);

        const row: any = stmt.getRow();
        assert.equal(row.id, i);
        assert.equal(row.name, `Dummy ${i}`);
        assert.equal(row.code, i * 100);
      }
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("SELECT 1 FROM ec_CustomAttribute WHERE ContainerId=? AND Instance LIKE '<IsMixin%' COLLATE NOCASE", (stmt: SqliteStatement) => {
      stmt.bindValue(1, "0x1f");
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });
  });

  it("Run plain SQL against readonly connection", () => {
    let iModel: IModelDb = IModelDb.createSnapshot(IModelTestUtils.prepareOutputFile("IModel", "sqlitesqlreadonlyconnection.bim"), { rootSubject: { name: "test" } });
    const iModelPath: string = iModel.briefcase.pathname;
    iModel.closeSnapshot();
    iModel = IModelDb.openSnapshot(iModelPath);

    iModel.withPreparedSqliteStatement("SELECT Name,StrData FROM be_Prop WHERE Namespace='ec_Db'", (stmt: SqliteStatement) => {
      let rowCount: number = 0;
      while (stmt.step() === DbResult.BE_SQLITE_ROW) {
        rowCount++;
        assert.equal(stmt.getColumnCount(), 2);
        const nameVal: SqliteValue = stmt.getValue(0);
        assert.equal(nameVal.columnName, "Name");
        assert.equal(nameVal.type, SqliteValueType.String);
        assert.isFalse(nameVal.isNull);
        const name: string = nameVal.getString();

        const versionVal: SqliteValue = stmt.getValue(1);
        assert.equal(versionVal.columnName, "StrData");
        assert.equal(versionVal.type, SqliteValueType.String);
        assert.isFalse(versionVal.isNull);
        const profileVersion: any = JSON.parse(versionVal.getString());

        assert.isTrue(name === "SchemaVersion" || name === "InitialSchemaVersion");
        if (name === "SchemaVersion") {
          assert.equal(profileVersion.major, 4);
          assert.equal(profileVersion.minor, 0);
          assert.equal(profileVersion.sub1, 0);
          assert.isAtLeast(profileVersion.sub2, 1);
        } else if (name === "InitialSchemaVersion") {
          assert.equal(profileVersion.major, 4);
          assert.equal(profileVersion.minor, 0);
          assert.equal(profileVersion.sub1, 0);
          assert.isAtLeast(profileVersion.sub2, 1);
        }
      }
      assert.equal(rowCount, 2);
    });
    iModel.closeSnapshot();
  });
});
