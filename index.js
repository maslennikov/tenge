/**
 * Base class for all entity models. Hides connection details under the hood.
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

module.exports = Tenge;

/**
 * Base model to be inherited in the app by each entity
 *
 * @param params.collection name of the collection to be associated with
 */
function Tenge(params) {
    var self = this;
    this._params = params || {};
    this._hooks = {
        before: {insert: []/*, update: [], remove: []*/},
        after: {insert: [], /*update: [],*/ upsert: []/*, remove: []*/}
    };

    // generating custom ids but not overwriting mongo native _id
    // TODO: use $setOnInsert to generate custom ids when upserting
    this._getCollection().ensureIndex({id: 1}, {unique: true});

    this.before('insert', function(params, next) {
        _.each(params.docs, function(doc) {
            doc.id = doc.id || self.makeID();
        });
        next();
    });
}

/**
 * Sets up the database singleton instance with given connection config
 */
Tenge.connect = function(config) {
    Tenge.prototype._db = mongojs(config.uri);
};

/**
 * Accessing the DB app-wide singleton
 */
Tenge.prototype._getDb = function() {
    this._assert(this._db, 'Not connected to database, use Tenge.connect())');
    return this._db;
};

Tenge.prototype._getCollection = function() {
    this._assert(this._params.collection, 'No collection name provided');
    return this._collection ||
        (this._collection = this._getDb().collection(this._params.collection));
};

/**
 * Generates a new OID, or converts id string into the mongo ObjectId if arg is
 * provided
 */
Tenge.prototype.makeOID = function(id) {
    return OID(id);
};

/**
 * Generates url-friendly id
 */
Tenge.prototype.makeID = function() {
    return shortid.generate();
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
Tenge.prototype._makeQuery = function(params) {
    var self = this;
    var $$ = _.get(params, 'query.$$', {});
    var query = _.omit(_.get(params, 'query'), '$$');

    _.transform($$, function(query, $$val, $$key, $$) {
        var transformer = self._makeQueryTransformers[$$key];
        self._assert(transformer,
            'No query transformer registered for "$$.' + $$key + '"');
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
Tenge.prototype._makeQueryTransformers = {
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
 * Hooks: 'before' will get all objects to be inserted via `params.docs`
 *        'after' will get all objects already inserted via `params.docs`
 *
 * @param params.doc a single object to be inserted
 * @param params.docs multiple objects to be inserted
 * @returns array with inserted objects having the proper id
 *
 * Important: passed docs will be modified in-place to contain id
 */
Tenge.prototype.insert = function(params, cb) {
    var self = this;
    F(function() {
        var docs = _.compact([].concat(params.doc, params.docs));
        self._assert(docs, 'no doc or docs specified for insert operation');
        self._runHooks(self._hooks.before.insert, docs, this.slot());

    }, function(err, docs) {
        self._getCollection().insert(docs, this.slot());

    }, function(err, docs) {
        self._runHooks(self._hooks.after.insert, docs, this.slot());

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
Tenge.prototype.find = function(params, cb) {
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
Tenge.prototype.findOne = function(params, cb) {
    this.find(params).next(cb);
};


/**
 * Returns the total number of documents matching the query
 *
 * @param [params.query] mongo query object
 */
Tenge.prototype.count = function(params, cb) {
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
Tenge.prototype.size = function(params, cb) {
    this.find(params).size(cb);
};

/**
 * A remove operation returning the cursor.
 *
 * All cursor stuff like `params.sort` will be applied to cursor when provided.
 *
 * @param [params.query] mongo query object
 * @param [params.fields] specification of fields of removed objects to return
 * @param [params.limit] limit the number of documents removed
 *
 * @returns an array of removed objects via callback
 */
Tenge.prototype.remove = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params);

    F(function() {
        //first getting the ids of objects to be updated
        self.find(params, this.slot());

    }, function(err, docs) {
        this.pass(docs);
        if (docs.length) {
            var ids = _.pluck(docs, '_id');
            self._getCollection().remove({_id: {$in: ids}}, this.slot());
        }

    }, function(err, docs, res) {
        this.pass(docs);

    }, cb);
};


/**
 * An update operation for a single document
 *
 * @param params.query mongo query object
 * @param params.(update|remove) mongo update object
 * @param [params.fields] specification of fields to return
 * @param [params.sort] specification of sorting to match the query
 * @param [params.upsert] whether upsert behavior is desired
 *
 * @returns an updated/upserted object via callback
 *
 * Important: if no document for was found, it will be considered an error; if
 * this behavior is not desirable, use `updateAll()`.
 */
Tenge.prototype.updateOne = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params);
    params = _.extend(params, {new: true});

    F(function() {
        self._getCollection().findAndModify(params, this.slot('multi'));

    }, function(err, result) {
        var doc = result[0];
        var lastErrorObject = result[1];

        self._assert(
            doc, params.upsert ? 'Upsert failed' : 'Document does not exist');

        this.pass(doc);

        if (lastErrorObject.upserted) {
            self._runHooks(self._hooks.after.upsert, [doc], this.slot());
        } else {
            //todo: update hook
        }

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
 * @param [params.upsert] whether upsert behavior is desired
 *
 * @returns a list of updated/upserted documents (may be empty) via callback
 */
Tenge.prototype.updateAll = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params, {sort: {_id: 1}});

    F(function() {
        //first getting the ids of objects to be updated
        self.find(_.extend({}, params, {fields: {_id: true}}), this.slot());

    }, function(err, docsToUpdate) {
        var ids = _.pluck(docsToUpdate, '_id');
        this.pass(ids);

        if (!ids.length && params.upsert) {
            //it will be an upsert
            self._getCollection().update(
                params.query,
                params.update,
                {upsert: true, multi: true},
                this.slot());
        } else {
            self._getCollection().update(
                {_id: {$in: ids}},
                params.update,
                {multi: true},
                this.slot());
        }

    }, function(err, updatedIds, result) {
        this.pass(updatedIds.length);
        var ids = updatedIds.length ? updatedIds : _.pluck(result.upserted, '_id');

        if (ids.length) {
            //fetching updated/upserted docs
            self.find(
                _.extend({}, params, {query: {_id: {$in: ids}}}),
                this.slot());
        } else {
            //not abusing mongo with empty queries
            this.pass([]);
        }

    }, function(err, updated, docs) {
       if (!docs.length) {
           this.pass([]);
       } else if (updated) {
           //todo update hook
           this.pass(docs);
       } else {
           self._runHooks(self._hooks.after.upsert, docs, this.slot());
       }

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
Tenge.prototype.before = function(action, handler) {
    var hooks = this._hooks.before[action];
    this._assert(hooks, 'Before-hook for action not supported: ' + action);
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
Tenge.prototype.after = function(action, handler) {
    var hooks = this._hooks.after[action];
    this._assert(hooks, 'After-hook for action not supported: ' + action);
    hooks.push(handler);
};


/**
 * Will trigger the hook chain stopping its execution after the first error
 * passed to the `next`.
 *
 * @param docs documents related to the hook operation
 * @returns passed and potentially modified docs via callback
 */
Tenge.prototype._runHooks = function(hooks, docs, cb) {
    var params = {docs: docs};
    var chain = F.when(null);
    _.each(hooks, function(hook) {
        chain = chain.then(function() {
            hook(params, this.slot());
        });
    });
    chain.anyway(function(err) { cb(err, params.docs) });
};

/**
 * Will throw an error with the specified message in the condition is falsy
 */
Tenge.prototype._assert = function(condition, message) {
    if (!condition) throw new Error("Tenge: " + message);
};
