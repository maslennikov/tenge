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
 * Tenge is supposed to be inherited every time an interface to a new collection
 * is desired.
 *
 * Important: before instantiating, call `Tenge.connect()`
 *
 * @param params.collection name of the collection to be associated with
 */
function Tenge(params) {
    var self = this;
    this._params = _.extend({}, params);
    this._hooks = {
        before: {insert: [], remove: []},
        after: {insert: [], update: [], upsert: [], remove: []}
    };
}

/**
 * Sets up the database singleton instance with given connection config
 *
 * @param params.uri should adhere to mongo connection string URI format
 * @param [params.authMechanism] string describing auth mechanism, valid options
 *                               'ScramSHA1', 'MongoCR' (default)
 *
 * @see `Tenge._db()`
 */
Tenge.connect = function(params) {
    var db = mongojs(params.uri, [], _.pick(params, 'authMechanism'));
    Tenge._db = function() {
        return db;
    };
};

/**
 * Singleton closure storing current db connection. Will throw an error unless
 * the `Tenge.connect()` called.
 *
 * @see `Tenge.connect()`
 */
Tenge._db = function(params) {
    Tenge._assert(false, 'Not connected to database, use Tenge.connect())');
};


/**
 * Accessing the DB app-wide singleton
 * @see `Tenge._db()`
 */
Tenge.prototype._db = function() {
    return Tenge._db();
};

/**
 * Retrieving a mongojs Collection object. The result is passed to the callback.
 *
 * When accessing the collection for the first time, Tenge will ensure that the
 * collection is properly initialized
 */
Tenge.prototype._collection = function(cb) {
    var self = this;
    var colname = this._params.collection;

    this._assert(colname, 'No collection name provided');

    F(function() {
        if (self._col) {
            this.pass(self._col);
        } else {
            self._initCollection(colname, this.slot());
        }
    }, function(err, col) {
        self._col = col;
        this.pass(col);
    }, cb);
};

/**
 * By default, the model will be set up for generating custom ids but not
 * overwriting mongo native _id.
 *
 * Please remember that no ids will be automatically generated during upsert
 *
 * @param colname collection name
 * @returns mongojs collection via callback
 *
 * @see `_collection()`
 */
Tenge.prototype._initCollection = function(colname, cb) {
    var self = this;

    F(function() {
        //assuming that collection already exists, otherwise we will get a mongo
        //error 'ns not found'
        var col = self._db().collection(colname);
        this.pass(col);
        col.ensureIndex({id: 1}, {unique: true}, this.slot());

    }, function(err, col) {
        //index is created, now hanging up the hook
        self.before('insert', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.id = doc.id || self.makeID();
            });
            next();
        });
        this.pass(col);

    }, cb);
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
 * A simple insert operation
 *
 * Hooks: 'before insert' will get all objects to be inserted via `params.docs`
 *        'after insert' will get all objects already inserted via `params.docs`
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
        self._collection(this.slot());
        var docs = _.compact([].concat(params.doc, params.docs));
        self._assert(docs, 'no doc or docs specified for insert operation');
        self._runHooks(self._hooks.before.insert, docs, this.slot());

    }, function(err, col, docs) {
        col.insert(docs, this.slot());

    }, function(err, docs) {
        self._runHooks(self._hooks.after.insert, docs, this.slot());

    }, cb);
};

/**
 * A simple find operation
 *
 * All mongo cursor stuff like `params.sort` will be applied to cursor when
 * provided, before the results are fetched into the callback via `toArray()`.
 *
 * @param [params.query] mongo query object
 * @param [params.fields] specification of fields ('projection') to return
 * @param [params.sort] cursor specification of sorting to match the query
 * @param [params.limit] cursor limit spec; a falsy value is treated as no limit
 * @param [params.skip] cursor skip spec
 * @param [cb] optional callback; if not passed, the cursor will be immediately
 * returned
 *
 * @returns a result of `toArray()` on the cursor via callback.
 */
Tenge.prototype.find = function(params, cb) {
    var self = this;

    F(function() {
        self._findCursor(params, this.slot());
    }, function(err, cursor) {
        cursor.toArray(this.slot());
    }, cb);
};

/**
 * Returns the first doc of the resultset matched by all passed params
 *
 * Params same as `find()` has
 */
Tenge.prototype.findOne = function(params, cb) {
    var self = this;

    F(function() {
        self._findCursor(params, this.slot());
    }, function(err, cursor) {
        cursor.next(this.slot());
    }, cb);
};


/**
 * Returns the total number of documents matching the query
 *
 * @param [params.query] mongo query object
 */
Tenge.prototype.count = function(params, cb) {
    var self = this;

    F(function() {
        self._findCursor(params, this.slot());
    }, function(err, cursor) {
        cursor.count(this.slot());
    }, cb);
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
    var self = this;

    F(function() {
        self._findCursor(params, this.slot());
    }, function(err, cursor) {
        cursor.size(this.slot());
    }, cb);
};

/**
 * Base command for find operations
 * @returns the cursor to matching resultset via callback.
 * @see `find()`, `findOne()`, `count()`, `size()`
 */
Tenge.prototype._findCursor = function(params, cb) {
    var self = this;
    params = _.defaults(this._makeQuery(params), params, {fields: {}});

    F(function() {
        self._collection(this.slot());
    }, function(err, col) {
        var cursor = col.find(params.query, params.fields);
        if (params.sort) cursor.sort(params.sort);
        if (params.skip) cursor.skip(params.skip);
        cursor.limit(params.limit ? params.limit : null);
        this.pass(cursor);
    }, cb);
};

/**
 * Removes documents matching the query filters.
 *
 * Hooks: 'before remove' will get all objects to be removed via `params.docs`
 *        'after remove' will get objects removed via `params.docs`
 *
 * @param [params.query] mongo query object
 * @param [params.fields] specification of fields of removed objects to return
 * @param [params.sort] sorting of results before fetching for the removal
 * @param [params.limit] limit the number of documents removed
 * @param [params.skip] cursor skip spec
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
        self._collection(this.slot());
        self._runHooks(self._hooks.before.remove, docs, this.slot());

    }, function(err, col, docs) {
        this.pass(docs);
        if (docs.length) {
            var ids = _.pluck(docs, '_id');
            col.remove({_id: {$in: ids}}, this.slot());
        }

    }, function(err, docs, result) {
        //Warning: the actual count of docs removed during this operation may be
        //different, it can be checked in result.nRemoved
        self._runHooks(self._hooks.after.remove, docs, this.slot());

    }, cb);
};


/**
 * An update operation for a single document
 *
 * Hooks: 'after update' will get object updated via `params.docs` array
 *        'after upsert' will get object upserted via `params.docs` array
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
        self._collection(this.slot());

    }, function(err, col) {
        col.findAndModify(params, this.slot('multi'));

    }, function(err, result) {
        var doc = result[0];
        var lastErrorObject = result[1];

        self._assert(
            doc, params.upsert ? 'Upsert failed' : 'Document does not exist');

        //any changes to this object in after-hooks will be properly reflected
        //in the final callback result
        this.pass(doc);

        if (lastErrorObject.upserted) {
            self._runHooks(self._hooks.after.upsert, [doc], this.slot());
        } else {
            self._runHooks(self._hooks.after.update, [doc], this.slot());
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
        self._collection(this.slot());
        //first getting the ids of objects to be updated
        self.find(_.extend({}, params, {fields: {_id: true}}), this.slot());

    }, function(err, col, docsToUpdate) {
        var ids = _.pluck(docsToUpdate, '_id');
        this.pass(ids);

        if (!ids.length && params.upsert) {
            //it will be an upsert
            col.update(
                params.query,
                params.update,
                {upsert: true, multi: true},
                this.slot());
        } else {
            col.update(
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
           self._runHooks(self._hooks.after.update, docs, this.slot());
       } else {
           self._runHooks(self._hooks.after.upsert, docs, this.slot());
       }

    }, cb);
};


/**
 * Amends the mongo query object with fields processed from `query.$$`.
 * Resulting query object won't contain the `$$` field.
 *
 * The `$$` object may contain only fields listed in `_queryTransformers`.
 *
 * @param params.query mongo query object
 * @returns {query: {...}}
 */
Tenge.prototype._makeQuery = function(params) {
    var self = this;
    var $$ = _.get(params, 'query.$$', {});
    var query = _.omit(_.get(params, 'query'), '$$');

    _.transform($$, function(query, $$val, $$key, $$) {
        var transformer = self._queryTransformers[$$key];
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
Tenge.prototype._queryTransformers = {
    id: function(val) {
        return {id: val};
    },
    ids: function(val) {
        return {id: {$in: _.compact(val)}};
    },
    _id: function(val) {
        return {_id: Tenge.makeOID(val)};
    },
    _ids: function(val) {
        return {_id: {$in: _.compact(_.map(val, Tenge.makeOID))}};
    }
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
Tenge._assert = function(condition, message) {
    if (!condition) throw new Error("Tenge: " + message);
};

Tenge.prototype._assert = function() {
    Tenge._assert.apply(null, arguments);
};
