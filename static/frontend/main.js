/**
 * @author Massimo Melina <a@rejetto.com>
 */

function loadJS(libs) {
    libs = libs.split(',');
    for (var i=libs.length; i--;) {
        document.write("<script src='/~/"+libs[i]+".js'></script>");
    } 
}

loadJS('extending,cs-shared,misc');


var socket, currentFolder, listFromServer, currentMode, foldersBefore=1, currentPage= 0;

// this object will hold all the customizable stuff, that is added in file "tpl.js"  
var TPL = function(event) {
    var fun = TPL[currentMode+'_'+event] || TPL[event];
    if (!fun) return;
    var newArgs = [];                               
    for (var i=1,a=arguments,l=a.length; i<l; ++i)
        newArgs.push(a[i]);         
    fun.apply(this, newArgs);
};

loadJS('frontend/tpl');

// understand the requested folder from the URL
function getURLfolder() {
    var sub = location.hash.substr(1);
    return sub.startsWith('/') ? sub : location.pathname+sub;
} // getURLfolder

$(function onJQ(){ // dom ready
    
    (function speedSetup() {

        function chooseSpeed(q, map, def){
            for (var k in map) {
                if (q <= k) return map[k];
            }
            return def;
        } // chooseSpeed
        
        $('#pagination').val( chooseSpeed(benchmark(), {
            5: 500,
            50: 200
        }, 50) );
    })();

    socket = io.connect(window.location.origin);
    
    socket.on('connect', function onIO(){ // socket ready
        log('connected');

        var saved = JSON.parse(getCookie('settings')) || {};
        ['Order','Mode','Pagination'].forEach(function(v){
            var lc = v.low();
            var update = window['update'+v];
            update(saved[lc]); // try to restore last options
            // change things at user will
            $('#'+lc).change(function(){ 
                update();
                redrawItems(); 
            }); 
        });
         
        loadFolder(getURLfolder(), function onFolder(){ // folder ready

            /* support for the BACK button: when the user clicks the BACK button, the address bar changes going out of   
                sync with the view. We fix it ASAP. I don't know an event for the address bar, so i'm polling. */
            repeat(300, function(){
                var shouldBe = getURLfolder(); 
                if (currentFolder != shouldBe) {
                    loadFolder(shouldBe);        
                } 
            });

        }); // don't redraw        
    });//socket connect
    
    socket.on('vfs.changed', function(data){
        log('vfs.changed',data);
        // it would be nicer to update only the changed item, but for now easily reload the whole dir
        var folder = data.uri.endsWith('/') ? data.uri : dirname(data.uri);
        if (folder === currentFolder) {
            loadFolder();            
        }
    });

    // item hovering
    $('#items').on({
        mouseenter: function(){
            if (!$(this).isOverflowed()) return; // is our label clipped?
            var lbl = $(this).find('.item-label');
            // make some changes so it's hopefully fully visible. We actually just mark it, leaving the real work to your css rules.
            lbl.addClass('full-label');
            // if no bg was assigned, the enlarged label may overlap other elements, and its transparency may cause very bad readability
            if (isTransparent(lbl.css('background-color'))) {
                lbl.css('background-color', lbl.getClosestBackgroundColor() || '#fff')
                    .data('remove bg', true);
            }
        },
        mouseleave: function(){
            // undo changes made few lines above
            var lbl = $(this).find('.full-label');
            lbl.removeClass('full-label');
            if (lbl.data('remove bg')) {
                lbl.css('background-color','');
                lbl.removeData('remove bg',null);
            }
        }
    }, '.item-link');

    /* display:float used by 'tiles' is CPU expensive when we get many items (500+ on a core2duo@2.1).
     * To ease this task we periodically set fixed line breaks.
     */
    var last;
    repeat(100, function(){
        if (currentMode !== 'tiles') {
            last = null;
            return;
        }
        var d = $('#items');
        var x = d.children(':first').width();
        if (!x) return; // no items
        var n = Math.floor((d.width() - 5) / x); // leave a small margin, otherwise the browser decides it is not truly fitting, and you get an undesired wrapping
        if ($.support.hover) n--; // we leave some space for popup properties
        if (n === last) return;
        last = n;
        d.children('.forced-br').removeClass('forced-br'); // clean
        d.children(':nth-child({0}n+1):not(:first)'.x(n)).addClass('forced-br'); // set new br
    });

});//dom ready

// ask the server for the items list of the specified folder, then sort and display
function loadFolder(path /** optional */, cb /** optional */) {
    if (path) currentFolder = path;
    // breadcrumbs
    $('#folder').html(
        '<a href="/#"><img src="'+getPicURI('home')+'"/></a>'+
        // build pairs text/link
        decodeURI(currentFolder).split('/').filter('A').map('["/"+A, "/#"+C.slice(0,B+1).join("/")+"/"]')
        // then to html
            .map('$("<a>").text(A[0]).attr({href:A[1]})[0].outerHTML').join('')
    );

    socket.emit('get list', { path:currentFolder }, function onGetList(reply){
        if (showError(reply)) return;
        listFromServer = reply; // hold it in a global variable, to not loose it
        convertList(reply);
        $('#folder-info').html("Items: <span id='num-items'>{0}</span>".x(reply.items.length));
        sortItems();                
        redrawItems();
        if (typeof cb == 'function') {
            cb();
        }
    });
} // loadFolder

function showError(reply) {
    if (reply.ok) return false;
    if (reply.error) alert('Error: '+reply.error);
    return true;
} // showError

// convert file list format: expands some field-names
function convertList(serverReply) {
    if (!serverReply) return;
    var a = serverReply.items;
    if (!a) return;
    for (var i=a.length; i--;) {
        var o = a[i];
        renameProperties(o, { n:'label', t:'type', s:'size'});
        switch (o.type) {
            case undefined: // no type is default type: file
                o.type = 'file'; // now continue with the case 'file'
            case 'file': // for files, calculate specific type
                var t = nameToType(o.label);
                if (t) o.type = t;
                break;
            case 'link':
                o.url = o.resource; 
                break;  
        }
        o.url = o.url || escapeLink(currentFolder+o.label)+(o.type == 'folder' ? '/' : '');
    }
} // convertList

// takes an object and renames some of its properties to the mapped names
function renameProperties(o, map) {
    for (var from in map) {
        var to = map[from];
        if (!(from in o)) continue;
        o[to] = o[from];
        delete o[from];
    }
} // renameProperties

// rebuild the DOM of items
function redrawItems() {    
    var x = $('#items').empty();

    if (!listFromServer) return;

    // add a link to the parent folder
    var cf = currentFolder; // shortcut
    if (cf > '/') {
        addItem({
            label: '&uarr;&uarr;',
            url: dirname(cf).includeTrailing('/'),
            type: 'folder',
            icon: 'folder'
        });
    }

    var n = listFromServer.items.length;
    var pages = Math.max(1, Math.ceil(n/currentPagination));
    if (currentPage >= pages) currentPage = pages-1;
    var overflow = (currentPagination && currentPagination < n);
    var ofs = overflow ? currentPage*currentPagination : 0;
    var max = currentPagination ? Math.min(currentPagination, n-ofs) : n;

    $('#paginator').remove();
    if (overflow) { // draw a paginator
        var d = $("<div id='paginator'>").insertBefore('#items');
        d.append("Pages ");
        for (var i=0; i<pages; i++) {
            $("<button>").text(i+1)
                .attr({page:i, disabled:i===currentPage}) // highlight current page (by disabling the button)
                .appendTo(d)
                .click(function(){
                    currentPage = +$(this).attr('page');
                    redrawItems();
                })
        }
    }

    for (var a=listFromServer.items, i=0; i<max; ++i) {
        var o = a[ofs+i]._clone(); // The item will be manipulated (also inside addItem), and we don't want to make this changes persistent over view modes
        o.icon = o.type;
        addItem(o);
    }
} // redrawItems

function escapeLink(s) {
    //return encodeURI(s)
    return s.replace('"','&quot;').replace("'", '&#39;').replace('%','%25')
}

// build the DOM for the single item, applying possible filtering functions 
function addItem(it) {
    it._expand({'icon-file':getIconURI(it.icon)}); // make this additions before the hook, so it can change these too
    TPL('onObjectItem', it); // custom treatment, especially mode-based
    $('<li>').append(TPL.item.format(it))
        .appendTo('#items')        
        .find('a.item-link').click(itemClickHandler);
} // addItem            

// called when an item is clicked
function itemClickHandler() {
    var x = $(this); 
    var h = x.attr('href');
    if (h.substr(-1) == '/') {
        if (location.pathname != '/') { // reloads the page to have a neater URL
            location = '/#'+h.substr(1);
            return false;
        }

        location.hash = (h.startsWith(location.pathname)) ? h.substr(location.pathname.length) : h;
        var loader = $("<img src='/~/pics/loader.gif'>").css(x.find('.item-icon').offset()._expand({position:'absolute'})).appendTo('body');
        loadFolder(h, function(){ loader.remove() });
        return false;
    }
    if (!x.attr('target')) {
        x.attr('target', 'preview'); // open the file in a new window so the app doesn't stop
    }
    return true;
} // itemClickHandler

function updateSettingsCookie(settings) {
    var v = getCookie('settings');
    try { v = JSON.parse(v) }
    catch(e) {}
    if (!v || typeof v != 'object') v = {};
    v._expand(settings);
    setCookie('settings', JSON.stringify(v));
} // updateSettingsCookie

function updateMode(v){
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#mode').val(); 
    else $('#mode').val(v);

    currentMode = v; // global 
    updateSettingsCookie({ mode: v }); // remember 
    $('html').attr('mode', v);
} // updateMode

function updatePagination(v){
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#pagination').val(); 
    else $('#pagination').val(v);

    currentPagination = v; // global
    updateSettingsCookie({ pagination: v }); // remember 
    redrawItems();
} // updatePagination

function updateOrder(v) {
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#order').val();
    else $('#order').val(v);
    
    currentOrder = v; // global
    updateSettingsCookie({ order: v }); // remember
    if (v) {
        $('#order option[value=""]').remove(); // after we have sorted the items there's no way to return to the original order, so let's hide this option
    }
    sortItems();
} // updateOrder

function sortItems() {
    if (!currentOrder || !listFromServer) return; // no job

    listFromServer.items.sort(function cb(a,b,field){
        field = field || currentOrder;
        if (field != 'type' && foldersBefore) { // if field is 'type', then the folders are always put at the top
            var res = -cmp(a['type'] == 'folder', b['type'] == 'folder');
            if (res) return res;
        }
        var va = a[field];
        var vb = b[field];
        switch (field) {
            case 'label':
                va=va.low(), vb=vb.low();
                break;
            case 'type':
                if (va == 'folder') va=''; // trick to get folders at the top
                if (vb == 'folder') vb='';
                break;
        }
        return cmp(va,vb) || (field=='label' ? 0 : cb(a,b,'label'));
    });
} // sortItems
