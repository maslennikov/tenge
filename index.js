/**
 * Base class for all models. Hides connection details under the hood.
 *
 * All methods receiving a callback get it in a form of `function(err, data)`;
 * in this case the `@returns` docstring applies to the callback `data` arg.
 */
'use strict';

var mongojs = require('mongojs');
var OID = mongojs.ObjectId;
var shortid = require('shortid');
var F = require('flowy');
var _ = require('lodash');

module.exports = Model;

/**
 * Base model to be inherited in the app
 *
 * @param params.collection name of the collection to be associated with
 */
function Model(params) {
    this._params = params || {};
    this._hooks = {
        before: {insert: []/*, update: [], remove: []*/},
        after: {insert: []/*, update: [], upsert: [], remove: []*/}
    };

    // generating custom ids but not overwriting mongo native _id
    // TODO: use $setOnInsert to generate custom ids when upserting
    this._getCollection().ensureIndex({id: 1}, {unique: true});
    this.before('insert', function(doc, next) {
        doc.id = doc.id || shortid.generate();
        next();
    });
}

/**
 * Sets up the database singleton instance with given connection config
 */
Model.connect = function(config) {
    Model.prototype._db = mongojs(config.uri);
};

/**
 * Accessing the DB app-wide singleton
 */
Model.prototype._getDb = function() {
    if (!this._db) {
        throw new Error('Model has no DB instance: please call connect() first');
    }
    return this._db;
};

Model.prototype._getCollection = function() {
    if (!this._params.collection) {
        throw new Error('No collection name provided');
    }
    return this._collection ||
        (this._collection = this._getDb().collection(this._params.collection));
};

/**
 * Converts id string into the mongo ObjectId
 */
Model.prototype.OID = function(id) {
    return OID(id);
};

/**
 * Amends the mongo query object with fields processed from `query.$$`.
 * Resulting query object won't contain the `$$` field.
 *
 * The `$$` object may contain only fields listed in `_makeQueryTransformers`.
 *
 * @param params.query mongo query object
 * @returns {query: {...}}
 */
Model.prototype._makeQuery = function(params) {
    var self = this;
    var $$ = _.get(params, 'query.$$', {});
    var query = _.omit(_.get(params, 'query'), '$$');

    _.transform($$, function(query, $$val, $$key, $$) {
        var transformer = self._makeQueryTransformers[$$key];
        if (!transformer) {
            throw new Error(
                'No query transformer registered for "$$.' + $$key + '"');
        }
        _.merge(query, transformer($$val, query, $$));
    }, query);

    return {query: query};
};

/**
 * Each transformer funciton should return an object for existing query to be
 * merged with and will be passed the following params:
 *
 * @param val value of `$$` under the corresponding key
 * @param query the query object to be merged into
 * @param $$ the whole `$$` object
 * @see `_makeQuery()`
 */
Model.prototype._makeQueryTransformers = {
    id: function(val) {
        return {id: val};
    },
    ids: function(val) {
        return {id: {$in: _.compact(val)}};
    }
};

/**
 * A simple insert operation
 *
 * Hooks: 'before' will get the whole `params.doc` object
 *
 * @param params.doc an array or a single object to be inserted
 * @returns inserted object(s) having the proper id
 *
 * Important: passed docs will be modified in-place to contain _id
 */
Model.prototype.insert = function(params, cb) {
    var self = this;
    F(function() {
        self._runHooksEach(self._hooks.before.insert, params.doc, this.slot());
    }, function(err, docOrDocs) {
        self._getCollection().insert(docOrDocs, this.slot());
    }, function(err, docOrDocs) {
        self._runHooksEach(self._hooks.after.insert, docOrDocs, this.slot());
    }, cb);
};

/**
 * A find operation returning the cursor.
 *
 * All cursor stuff like `params.sort` will be applied to cursor when provided.
 *
 * @param [params.query] mongo query object
 * @param [params.fields] specification of fields ('projection') to return
 * @param [params.sort] cursor specification of sorting to match the query
 * @param [params.limit] cursor limit spec
 * @param [params.skip] cursor skip spec
 * @param [cb] optional callback; if not passed, the cursor will be immediately
 * returned
 *
 * @returns a cursor to the selected documents (synchronously) result of
 * `toArray()` on the cursor via callback.
 */
Model.prototype.find = function(params, cb) {
    params = _.defaults(this._makeQuery(params), params, {fields: {}});
    var cursor = this._getCollection().find(params.query, params.fields);

    if (params.sort) cursor.sort(params.sort);
    if (params.skip) cursor.skip(params.skip);
    cursor.limit(params.limit ? params.limit : null);

    return cb ? cursor.toArray(cb) : cursor;
};

/**
 * Returns the first doc of the resultset matched by all passed params
 *
 * Params same as `find()` has
 */
Model.prototype.findOne = function(params, cb) {
    this.find(params).next(cb);
};


/**
 * Returns the total number of documents matching the query
 *
 * @param [params.query] mongo query object
 */
Model.prototype.count = function(params, cb) {
    this.find(params).count(cb);
};

/**
 * Returns the number of documents matching the query after applying skip, and
 * limit conditions.
 *
 * @param [params.query] mongo query object
 * @param [params.limit] cursor limit spec
 * @param [params.skip] cursor skip spec
 */
Model.prototype.size = function(params, cb) {
    this.find(params).size(cb);
};

/**
 * An update operation for a single document
 *
 * @param params.query mongo query object
 * @param params.(update|remove) mongo update object
 * @param [params.fields] specification of fields to return
 * @param [params.sort] specification of sorting to match the query
 * @param [params.opts] mongo update operation options (upsert)
 * @returns an updated object
 *
 * Important: if no document for was found, it will be considered an error; if
 * this behavior is not desirable, use `updateAll()`.
 */
Model.prototype.updateOne = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params);
    params = _.extend(params, params.opts, {new: true});

    F(function() {
        self._getCollection().findAndModify(params, this.slot());
    }, function(err, result) {
        if (!result) throw new Error('Document does not exist');
        this.pass(result);
    }, cb);
};

/**
 * An update operation for multiple documents.
 *
 * Mongo doesn't allow us to get the list of updated documents out of the box,
 * hence this workaround.
 *
 * @param params.query mongo query object
 * @param params.update mongo update object
 * @param [params.fields] specification of fields to return
 * @param [params.sort] specification of sorting to match the query
 * @param [params.opts] mongo update operation options (upsert)
 * @returns a list of updated objects (may be empty)
 */
Model.prototype.updateAll = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params, {sort: {_id: 1}});
    params.opts = _.extend({}, params.opts, {multi: true});

    F(function() {
        //first getting the ids of objects to be updated
        self.find(_.extend({}, params, {fields: {_id: true}}), this.slot());

    }, function(err, docs) {
        var ids = _.pluck(docs, '_id');
        this.pass(ids);
        if (!docs.length) {
            //continue normally, it may be an upsert
            this.pass({});
        } else {
            self._getCollection().update(
                {_id: {$in: ids}}, params.update, params.opts, this.slot());
        }

    }, function(err, ids, res) {
        //here in res could be the ids of upserted docs
        ids = ids.concat(_.compact(_.pluck(res.upserted, '_id')));
        //we don't have in res updated docs, so fetch 'em all
        self.find(_.extend({}, params, {query: {_id: {$in: ids}}}), this.slot());

    }, cb);
};


/**
 * Registering before-hooks for actions like 'insert', 'update'.
 *
 * Hook is a `function(params, next)` receiving params appropriate to the
 * particular action, and next is a callback `function([err])` acting like in
 * express middleware.
 *
 * Hooks are welcome to modify the params. Every hook will get the same params
 * object.
 *
 * For params format, see the doc for corresponding action.
 */
Model.prototype.before = function(action, handler) {
    var hooks = this._hooks.before[action];
    if (!hooks) {
        throw new Error('Before-hook for action not supported: ' + action);
    }
    hooks.push(handler);
};

/**
 * Registering after-hooks for actions like 'insert', 'update'.
 *
 * Hook is a `function(params, next)` receiving params appropriate to the
 * particular action, and next is a callback `function([err])` acting like in
 * express middleware.
 *
 * Hooks are welcome to modify the params. Every hook will get the same params
 * object.
 *
 * For params format, see the doc for corresponding action.
 */
Model.prototype.after = function(action, handler) {
    var hooks = this._hooks.after[action];
    if (!hooks) {
        throw new Error('After-hook for action not supported: ' + action);
    }
    hooks.push(handler);
};

/**
 * Will trigger the hook chain stopping its execution after the first error
 * passed to the `next`.
 *
 * @returns passed and potentially modified params onject via callback
 */
Model.prototype._runHooks = function(hooks, params, cb) {
    var chain = F.when(null);
    _.each(hooks, function(hook) {
        chain = chain.then(function() {
            hook(params, this.slot());
        });
    });
    chain.anyway(function(err) { cb(err, params) });
};

/**
 * Will trigger given hooks for each element in `docOrDocs` if it's an array;
 * otherwise it'll behave like _runHooks()
 */
Model.prototype._runHooksEach = function(hooks, docOrDocs, cb) {
    var self = this;
    F(function() {
        if (_.isArray(docOrDocs)) {
            var nested = this.slotGroup();
            _.each(docOrDocs, function(doc) {
                self._runHooks(hooks, doc, nested.slot());
            });
        } else {
            self._runHooks(hooks, docOrDocs, this.slot());
        }
    }, cb);
};
