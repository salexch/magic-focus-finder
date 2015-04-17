define(['lodash'], function (_) {
    'use strict';

    var defaultConfig = {
            keymap : {
                38 : 'up',
                40 : 'down',
                37 : 'left',
                39 : 'right',
                13 : 'enter'
            },
            focusableAttribute : 'focusable',
            defaultFocusedElement : null,
            container : 'document',
            eventNamespace : 'magicFocusFinder',
            focusedClass : 'focused',
            overrideDirectionAttribute : 'focus-overrides',
            captureFocusAttribute : 'capture-focus',
            dynamicPositionAttribute : 'dynamic-position',
            watchDomMutations : true
        },
        internal = {
            configured: false,
            canMove : true,
            currentlyFocusedElement : null,
            knownElements : [],
            // Each element will get the following properties when registered:
            // magicFocusFinderPosition = the elements position.
            // magicFocusFinderDirectionOverrides = if the element had any direction overrides.
            domObserver : null
        },
        mff = {
            configure : configure,
            getConfig : getConfig,
            start : start,
            setCurrent : setCurrent,
            getCurrent : getCurrent,
            getKnownElements : getKnownElements,
            refresh : refresh,
            destroy : destroy,
            move : {
                up : _moveUp,
                down : _moveDown,
                left : _moveLeft,
                right : _moveRight,
                enter : _fireEnter
            }
        };

    // for now mff is a singleton
    return mff;

    function configure(options) {
        internal.config = _.extend(_.cloneDeep(defaultConfig), options);
        internal.configured = true;
        return mff;
    }

    function getConfig() {
        return internal.config;
    }

    function start() {
        if (!internal.configured) {
            internal.config = _.cloneDeep(defaultConfig);
        } else {
            internal.configured = false;
        }

        if (internal.config.defaultFocusedElement) {
            setCurrent(internal.config.defaultFocusedElement);
        }

        refresh();

        if(internal.config.watchDomMutations) {
            _setupAndStartWatchingMutations();
        }

        return mff;
    }

    function setCurrent(querySelector) {
        var currentlyFocusedElement = internal.currentlyFocusedElement,
            element;

        element = querySelector && querySelector.nodeName ? querySelector : document.querySelector(querySelector);

        if(element) {
            if(currentlyFocusedElement) {

                _fireHTMLEvent(currentlyFocusedElement, 'losing-focus');
                currentlyFocusedElement.classList.remove(internal.config.focusedClass);
                currentlyFocusedElement.blur();
                _fireHTMLEvent(currentlyFocusedElement, 'focus-lost');
            }


            _fireHTMLEvent(element, 'gaining-focus');
            element.classList.add(internal.config.focusedClass);
            element.focus();
            _fireHTMLEvent(element, 'focus-gained');

            internal.currentlyFocusedElement = element;
        }

        return mff;
    }

    function getCurrent() {
        return internal.currentlyFocusedElement;
    }

    function getKnownElements() {
        return internal.knownElements;
    }

    function refresh() {
        var container;

        if(internal.config.container === 'document') {
            container = document;
        } else if(internal.config.container.nodeName){
            container = internal.config.container;
        } else {
            container = document.querySelector(internal.config.container);
        }

        _.once(_setupBodyKeypressListener)();

        internal.knownElements = [];

        [].forEach.call(container.querySelectorAll('['+ internal.config.focusableAttribute +']'), _registerElement);

        return mff;
    }

    function destroy() {
        internal.knownElements = [];
        internal.configured = false;
        internal.canMode = true;
        internal.currentlyFocusedElement = null;
        configure(defaultConfig);
        _removeBodyKeypressListener();
        _removeMutationObservers();
    }

    function _eventManager(event) {
        var direction;

        if(!internal.canMove) {
            return;
        }

        _recalculateDynamicElementPositions();

        if(internal.currentlyFocusedElement) {
            direction = internal.config.keymap[event.keyCode];

            if(direction && 'skip' === internal.currentlyFocusedElement.magicFocusFinderDirectionOverrides[direction]) {
                return;
            } else if(direction && internal.currentlyFocusedElement.magicFocusFinderDirectionOverrides[direction]) {
                setCurrent(internal.currentlyFocusedElement.magicFocusFinderDirectionOverrides[direction]);
            } else if(direction) {
                mff.move[direction]();
            }
        } else {
            _setDefaultFocus();
        }
    }

    function _setDefaultFocus() {
        if(internal.config.defaultFocusedElement) {
            setCurrent(internal.config.defaultFocusedElement);
        } else {
            setCurrent(_.first(internal.knownElements));
        }
    }

    function _registerElement(element) {
        var computedStyle = window.getComputedStyle(element);

        if(computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
            return false;
        }

        element.magicFocusFinderPosition = _getPosition(element);
        element.magicFocusFinderDirectionOverrides = _getDirectionOverrides(element);

        if(element.hasAttribute(internal.config.captureFocusAttribute)) {
            setCurrent(element);
        }

        internal.knownElements.push(element);
    }

    function _unregisterElement(element) {
        internal.knownElements = _.reject(internal.knownElements, function(knownElement) {
            return knownElement.isEqualNode(element);
        });
    }

    function _getPosition(element) {
        var boundingRect = element.getBoundingClientRect(),
            centerX = Math.round(boundingRect.left + (boundingRect.width / 2)),
            centerY = Math.round(boundingRect.top + (boundingRect.height / 2));

        return {
            // Top-left corner coords
            x : boundingRect.left,
            y : boundingRect.top,
            // Outer top center coords
            otx : centerX,
            oty : boundingRect.top,
            // Outer bottom center coords
            obx : centerX,
            oby : boundingRect.bottom,
            // Outer left center coords
            olx : boundingRect.left,
            oly : centerY,
            // Outer right center coords
            orx : boundingRect.right,
            ory : centerY
        };
    }

    function _recalculateDynamicElementPositions() {
        _.each(internal.knownElements, function(knownElement) {
            if(knownElement.hasAttribute(internal.config.dynamicPositionAttribute)) {
                knownElement.magicFocusFinderPosition = _getPosition(knownElement);
            }
        });
    }

    function _moveUp() {
        var closeElements = _findCloseElements(function(current, other){
            return current.oty >= other.oby;
        });

        _activateClosest(closeElements, 'up', function(current, other){
            return Math.sqrt(Math.pow(current.oty - other.oby, 2) + Math.pow(current.otx - other.obx, 2));
        });
    }

    function _moveDown() {
        var closeElements = _findCloseElements(function(current, other) {
            return current.oby <= other.oty;
        });

        _activateClosest(closeElements, 'down', function(current, other) {
            return Math.sqrt(Math.pow(current.obx - other.otx, 2) + Math.pow(current.oby - other.oty, 2));
        });
    }

    function _moveLeft() {
        var closeElements = _findCloseElements(function(current, other) {
            return current.olx >= other.orx;
        });

        _activateClosest(closeElements, 'left', function(current, other) {
            return Math.sqrt(Math.pow(current.olx - other.orx, 2) + Math.pow(current.oly - other.ory, 2));
        });
    }

    function _moveRight() {
        var closeElements = _findCloseElements(function(current, other) {
            return current.orx <= other.olx;
        });

        _activateClosest(closeElements, 'right', function(current, other) {
            return Math.sqrt(Math.pow(current.orx - other.olx, 2) + Math.pow(current.ory - other.oly, 2));
        });
    }

    function _fireEnter() {
        _fireMouseEvent(internal.currentlyFocusedElement, 'click');
    }

    function _getDirectionOverrides(element) {
        if(element.hasAttribute(internal.config.overrideDirectionAttribute)) {
            return _.zipObject(['up', 'right', 'down', 'left'], _.map(element.getAttribute(internal.config.overrideDirectionAttribute).split(' '), function(direction) {
                return direction !== 'null' ? direction : null;
            }));
        } else {
            return {};
        }
    }

    function _findCloseElements(isClose) {
        var currentElementsPosition = internal.currentlyFocusedElement.magicFocusFinderPosition;

        return _.filter(internal.knownElements, function(element) {
            var isCloseElement = isClose(currentElementsPosition, element.magicFocusFinderPosition);

            return isCloseElement && !internal.currentlyFocusedElement.isEqualNode(element);
        });
    }

    function _activateClosest(closeElements, direction, getDistance) {
        var closestElement,
            closestDistance,
            currentElementsPosition = internal.currentlyFocusedElement.magicFocusFinderPosition;

        // Find closest element within the close elements
        _.each(closeElements, function(closeElement) {
            var closeElementsPosition = closeElement.magicFocusFinderPosition,
                currentDistance;

            // Find distance between 2 elements
            currentDistance = getDistance(currentElementsPosition, closeElementsPosition);

            // Check if is the closest found yet
            if(_.isUndefined(closestDistance) || currentDistance < closestDistance) {
                closestDistance = currentDistance;
                closestElement = closeElement;
            }

            if(currentDistance === 0) {
                return false; // exit early for speed.
            }
        });

        if(closestElement){
            setCurrent(closestElement);
        }
    }

    function _setupBodyKeypressListener() {
        document.querySelector('body').addEventListener('keydown', _eventManager);
    }

    function _removeBodyKeypressListener() {
        document.querySelector('body').removeEventListener('keydown', _eventManager);
    }

    function _setupAndStartWatchingMutations() {
        // Home baked mutation observer. The shim was VERY slow. This is much faster.
        if(window.MutationObserver || window.WebKitMutationObserver) {
            internal.domObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    _.each(mutation.addedNodes, _addNodeFromMutationEvent);

                    _.each(mutation.removedNodes, _removeNodeFromMutationEvent);
                });
            });

            internal.domObserver.observe(document, { childList: true, subtree : true });
        } else {
            document.querySelector('body').addEventListener('DOMNodeInserted', _addNodeFromDomNodeAddedEvent);

            document.querySelector('body').addEventListener('DOMNodeRemoved', _removeNodeFromDomNodeAddedEvent);
        }
    }

    function _addNodeFromMutationEvent(node) {
        if(node.nodeType === 1 && node.hasAttribute(internal.config.focusableAttribute) && node.nodeName !== '#comment') {
            _registerElement(node);
        }
    }

    function _removeNodeFromMutationEvent(node) {
        if(node.nodeType === 1 && node.hasAttribute(internal.config.focusableAttribute)) {
            _unregisterElement(node);
        }
        if(internal.currentlyFocusedElement && internal.currentlyFocusedElement.isEqualNode(node)) {
            _setDefaultFocus();
        }
    }

    function _addNodeFromDomNodeAddedEvent(event) {
        if(event.target.nodeType === 1 && event.target.hasAttribute(internal.config.focusableAttribute) && event.target.nodeName !== '#comment') {
            _registerElement(event.target);
        }
    }

    function _removeNodeFromDomNodeAddedEvent(event) {
        if(event.target.nodeType === 1 && event.target.hasAttribute(internal.config.focusableAttribute) && event.target.nodeName !== '#comment') {
            _unregisterElement(event.target);
        }
        if(internal.currentlyFocusedElement && internal.currentlyFocusedElement.isEqualNode(event.target)) {
            _setDefaultFocus();
        }
    }

    function _removeMutationObservers() {
        if(window.MutationObserver || window.WebKitMutationObserver) {
            internal.domObserver && internal.domObserver.disconnect();
            internal.domObserver = null;
        } else {
            document.querySelector('body').removeEventListener('DOMNodeInserted', _addNodeFromDomNodeAddedEvent);
            document.querySelector('body').removeEventListener('DOMNodeRemoved', _removeNodeFromDomNodeAddedEvent);
        }
    }

    function _fireHTMLEvent(element, eventName) {
        var event = document.createEvent('HTMLEvents');
        event.initEvent(eventName, true, true);
        element.dispatchEvent(event);
    }

    function _fireMouseEvent(element, eventName) {
        var event = document.createEvent('MouseEvents');
        event.initEvent(eventName, true, true);
        element.dispatchEvent(event);
    }
});
