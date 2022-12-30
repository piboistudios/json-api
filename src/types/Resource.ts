import { deleteNested, isPlainObject, objectIsEmpty } from "../util/misc";
import Relationship, { RelationshipJSON, RelationshipArgs } from "./Relationship";
import { UrlTemplates } from "./index";

export type ResourceJSON = {
  id: string;
  type: string;
  attributes?: object;
  relationships?: { [name: string]: RelationshipJSON };
  meta?: object;
  links?: { [x: string]: string };
};

// Used after an id has been assigned by the server.
export type ResourceWithId = Resource & { id: string };

// Used after the typePath has been set.
export type ResourceWithTypePath = Resource & { typePath: string[] };

export default class Resource {
  private _id: string | undefined;
  private _type!: string;
  private _relationships!: { [name: string]: Relationship };
  private _attrs!: { [name: string]: any };
  private _meta!: object;

  /**
   * A key that can hold arbitrary extra data that the adapter has asked to be
   * associated with this resource. Used by the MongooseAdapter for updates.
   */
  public adapterExtra: any;

  /**
   * The type path is an array of all the type names that apply to this
   * resource, ordered with the smallest sub type first and parent types later.
   * It is set after confirming the resource's types from the adapter or
   * validating the user's `meta.types` input. By contrast, the typesList
   * (see below) represents a provisional, unvalidated typePath as provided by
   * the user, if any. Having this list, in this order, is important for the
   * beforeSave/beforeRender transforms, which use it to lookup the transform
   * functions from the right resource type descriptions.
   */
  public typePath: string[] | undefined;

  constructor(
    type: string,
    id?: string,
    attrs = Object.create(null),
    relationships = Object.create(null),
    meta: { types?: string[] } = Object.create(null)
  ) {
    [this.type, this.id, this.attrs, this.relationships, this.meta] =
      [type, id, attrs, relationships, meta];
  }

  get id() {
    return this._id;
  }

  set id(id) {
    // allow empty id for the case of a new resource POST.
    this._id = (typeof id !== "undefined") ? String(id) : undefined;
  }

  get type() {
    return this._type;
  }

  set type(type) {
    if (!type) {
      throw errorWithCode("type is required", 1);
    }

    this._type = String(type);
  }

  /**
   * The typesList is intended to represent a list of type names provided by
   * the end-user. It should only be defined on resources that are created from
   * end-user data, and it may not be a valid typePath. Resources instantiated
   * by the server should never have a typesList, but should instead have a
   * typePath. See Resource.typePath.
   */
  get typesList() {
    return (this.meta as any).types;
  }

  equals(otherResource: Resource) {
    return this.id === otherResource.id && this.type === otherResource.type;
  }

  get attrs() {
    return this._attrs;
  }

  set attrs(attrs) {
    validateFieldGroup(attrs, this._relationships, true);
    this._attrs = attrs;
  }

  get attributes() {
    return this.attrs;
  }

  set attributes(attrs) {
    this.attrs = attrs;
  }

  get relationships() {
    return this._relationships;
  }

  set relationships(relationships: { [name: string]: Relationship }) {
    validateFieldGroup(relationships, this._attrs);
    this._relationships = relationships;
  }

  set meta(meta) {
    if (typeof meta !== "object" || meta === null) {
      throw errorWithCode("meta must be an object.", 2);
    }

    this._meta = meta;
  }

  get meta() {
    return this._meta;
  }

  removeAttr(attrPath: string) {
    if (this._attrs) {
      deleteNested(attrPath, this._attrs);
    }
  }

  removeRelationship(relationshipPath: string) {
    if (this._relationships) {
      deleteNested(relationshipPath, this._relationships);
    }
  }

  setRelationship(relationshipPath: string, data: RelationshipArgs["data"]) {
    validateFieldGroup({ [relationshipPath]: true }, this._attrs);
    this._relationships[relationshipPath] = Relationship.of({
      data,
      owner: { type: this._type, id: this._id, path: relationshipPath }
    });
  }

  toJSON(urlTemplates: UrlTemplates): ResourceJSON {
    const hasMeta = !objectIsEmpty(this.meta);
    const showTypePath = this.typePath && this.typePath.length > 1;
    const meta = showTypePath
      ? { ...this.meta, types: this.typePath }
      : this.meta;

    const json = <ResourceJSON>{
      id: this.id,
      type: this.type,
      attributes: this.attrs,
      ...(showTypePath || hasMeta ? { meta } : {})
    };

    // use type, id, meta and attrs for template data, even though building
    // links from attr values is usually stupid (but there are cases for it).
    const templateData = { ...json };
    // const selfTemplate = urlTemplates.self;

    const topLevelTemplates = Object.keys(urlTemplates).filter(t => ['relationship', 'related', '$top'].indexOf(t) === -1);
    topLevelTemplates.forEach(t => {
      if (!urlTemplates[t]) return;
      if (!json.links) json.links = {};
      if (!(urlTemplates[t] instanceof Function)) {
        json.links[t] = String(urlTemplates[t]);
        return;
      }
      json.links[t] = (urlTemplates[t] as any)(templateData);
    });

    if (!objectIsEmpty(this.relationships)) {
      json.relationships = {};

      Object.keys(this.relationships).forEach(path => {
        const { related, relationship } = urlTemplates;
        const finalTemplates = { related, self: relationship };

        (json.relationships as any)[path] =
          this.relationships[path].toJSON(finalTemplates);
      });
    }

    return json;
  }
}

/**
 * Checks that a group of fields (i.e. the attributes or the relationships
 * objects) are provided as objects and that they don't contain `type` and
 * `id` members. Also checks that attributes and relationships don't contain
 * the same keys as one another, and it checks that complex attributes don't
 * contain "relationships" or "links" members.
 *
 * @param {Object} group The an object of fields (attributes or relationships)
 *    that the user is trying to add to the Resource.
 * @param {Object} otherFields The other fields that will still exist on the
 *    Resource. The new fields are checked against these other fields for
 *    naming conflicts.
 * @param {Boolean} isAttributes Whether the `group` points to the attributes
 *    of the resource. Triggers complex attribute validation.
 * @return {undefined}
 * @throws {Error} If the field group is invalid given the other fields.
 */
function validateFieldGroup(group: object, otherFields: object, isAttributes = false) {
  if (!isPlainObject(group)) {
    throw errorWithCode("Attributes and relationships must be provided as an object.", 3);
  }

  if ("id" in group || "type" in group) {
    throw errorWithCode("`type` and `id` cannot be used as field names.", 4);
  }

  Object.keys(group).forEach(field => {
    if (isAttributes) {
      validateComplexAttribute((group as any)[field]);
    }

    if (otherFields !== undefined && typeof (otherFields as any)[field] !== "undefined") {
      throw errorWithCode(
        "A resource can't have an attribute and a relationship with the same name.",
        5,
        { field }
      );
    }
  });
}

function validateComplexAttribute(attrOrAttrPart: any) {
  if (isPlainObject(attrOrAttrPart)) {
    const { relationships, links } = attrOrAttrPart;
    if (typeof relationships !== "undefined" || typeof links !== "undefined") {
      throw errorWithCode(
        'Complex attributes may not have "relationships" or "links" keys.',
        6
      );
    }

    Object.keys(attrOrAttrPart).forEach(key => {
      validateComplexAttribute(attrOrAttrPart[key]);
    });
  }
  else if (Array.isArray(attrOrAttrPart)) {
    attrOrAttrPart.forEach(validateComplexAttribute);
  }
}

/**
 * We throw errors with a code number so that we can identify the error type
 * and convert the error to an APIError, but only if the error was caused by
 * client-provided data. If, say, an Adapter created an invalid resource object
 * from data it looked up, that's just an internal error and shouldn't be
 * converted to an APIError at all or at least not to the same one.
 *
 * Note: the codes are only meant to be unique within this file!
 */
function errorWithCode(message: string, code: number, extra?: object) {
  const x: any = new Error(message);
  x.code = code;
  Object.assign(x, extra);
  return x;
}
