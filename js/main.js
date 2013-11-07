  /**省份的代码表:"110000", "120000", "130000", "150000", "140000", "310000", 
  "340000", "350000", "360000", "320000", "370000", "330000", "500000", 
  "520000", "510000", "540000", "530000", "450000", "440000", "460000", 
  "620000", "640000", "630000", "610000", "650000", "430000", "410000", 
  "420000", "230000", "220000", "210000"
  **/
 
  dojo.require("dijit.layout.BorderContainer");
  dojo.require("dijit.layout.ContentPane");
  dojo.require("esri.map");
  dojo.require("esri.dijit.Popup");
  dojo.require("esri.layers.FeatureLayer");
  dojo.require("esri.dijit.Legend");
  dojo.require("dojox.data.CsvStore");

  var map, featureLayer, current = start = 1971, end = 2006, anim, interval = 1000;

  function init() {
    var bounds = new esri.geometry.Extent({"xmin":-32518023,"ymin":2968084,"xmax":-24299514,"ymax":6842524,"spatialReference":{"wkid":102100}});
    map = new esri.Map("map", {
      extent: bounds,
      infoWindow: new esri.dijit.Popup(null, dojo.create("div")),
      slider: false
    });
    dojo.connect(map, "onLoad", function (map) {
      dojo.connect(dijit.byId("map"), "resize", map, map.resize);
      initOperationalLayer(map);
    });
    var url = "http://cache1.arcgisonline.cn/ArcGIS/rest/services/ChinaOnlineStreetGray/MapServer";
    var tiledLayer = new esri.layers.ArcGISTiledMapServiceLayer(url);
    map.addLayer(tiledLayer);

    // set up play/pause buttons
    dojo.connect(dojo.byId("pause"), "onclick", function () {
      dojo.style(this, "display", "none");
      dojo.style("play", "display", "inline-block");
      animPause();
    });
    dojo.connect(dojo.byId("play"), "onclick", function () {
      dojo.style(this, "display", "none");
      dojo.style("pause", "display", "inline-block");
      animPlay();
    });
    dojo.connect(dojo.byId("faster"), "onclick", function () {
      animFast();
    });
    dojo.connect(dojo.byId("slower"), "onclick", function () {
      animSlow();
    });
  }
	
	//初始化数据
  function initOperationalLayer(map) {
    var content = "<b>${Name_CHN}</b> \
                  <br><b>编号</b>: ${Code} \
                  <br><b>变化率</b>: ${RATE}"; // \
                  // <br><National Average: ${NATLAVG}";
    var infoTemplate = new esri.InfoTemplate("&nbsp;", content);
    featureLayer = new esri.layers.FeatureLayer("http://localhost:6080/arcgis/rest/services/2013UC/citesArea/MapServer/0", {
      mode: esri.layers.FeatureLayer.MODE_ONDEMAND,
      outFields: ["Name_CHN", "Code"],
      infoTemplate: infoTemplate,
      opacity: .85,
      visible: true
    });

    // associate a clicked feature with the popup so it 
    // can be easily updated while the data animates
    dojo.connect(featureLayer, "onClick", function(e) {
      map.infoWindow.setFeatures([e.graphic]);
    });

    map.addLayer(featureLayer);
    loadAttributeData("cities.csv")
      .then(dojo.partial(createRenderer, start, "Code"))
      .then(dojo.partial(addRenderer, featureLayer))
      .then(animPlay);
  }

	//加载和解析CSV数据
  function loadAttributeData(url) {
    var def = new dojo.Deferred();
    var csv = new dojox.data.CsvStore({
      url: url
    });

    csv.fetch({
      onComplete: dojo.partial(processCsv, def),  //如果不使用参数，应该使用dojo.hitch（processCsv）, 使用dojo.partial的目的是在回调函数processCsv给它最前面增加一个参数def
      onError: function (err) {
        console.log("csv error: ", err);
      }
    });
    return def;
  }

  function processCsv(def, items, request) { //process csv data and create in memory object store.
    var store = request.store;
    var minYearPopulation = 1970;
    var maxYearPopulation = 2006;
    var counties = {};
    counties.minVal = Infinity;
    counties.maxVal = -Infinity;
    dojo.forEach(items, function (item) {
      var countyFips = store.getValue(item, "county_fips");
      var stateFips = store.getValue(item, "state_fips");
      var fips = dojo.string.pad(stateFips, 2, "0") + dojo.string.pad(countyFips, 3, "0");
      var population = {};
      population.maxVal = -Infinity;
      for (var year = minYearPopulation; year <= maxYearPopulation; year++) {
        var fieldName = "pop" + year;
        var popValue = parseInt(store.getValue(item, fieldName), 10);
        population[year] = popValue;
        population.maxVal = (popValue > population.maxVal) ? popValue : population.maxVal;
        counties.minVal = (popValue < counties.minVal) ? popValue : counties.minVal;
        counties.maxVal = (popValue > counties.maxVal) ? popValue : counties.maxVal;
      } 
      // counties[fips] = population;
      var fips1 = store.getValue(item, "Code");
      counties[fips1] = population;
    });
    console.log("counties: ", counties);
    //console.log("usa total population for 1970: ",counties['00000'][1970]);
    //console.log("counties min and max: ", counties, counties.minVal, counties.maxVal);
    //console.log("Population for a county for a specific year: ",counties['01001'][1970]);  //population from fips 01000 for 1970 -- Autauga County, AL
    //console.log("Max Population in a county across years: ",counties['01001'][maxVal]);  //return the max value for a county across the time range
    def.resolve(counties);
  }

  function createRenderer(startYear, joinField, data) {
    // use a function to calculate the value used to render
    // a feature
    var statisticGenerator = function (graphic) {
      var joinKey = graphic.attributes[renderer._joinField],
        currentYear = renderer._currentYear,
        data = renderer._data,
        dataValue = 0,
        previousValue = 0;

      // currentYear is a global variable
      if (data[joinKey] && data[joinKey][currentYear]) {
        dataValue = data[joinKey][currentYear];
        previousValue = data[joinKey][currentYear - 1];
      }

      // add the change rate to the graphic's attributes
      // so it's displayed in the popup
      var rate = calculateChange(dataValue, previousValue, 1);
      graphic.attributes.RATE = dojo.number.round(rate, 2) + "%";

      return rate;
    };

    var defaultSymbol = new esri.symbol.SimpleFillSymbol().setColor(null);
    defaultSymbol.setOutline(new esri.symbol.SimpleLineSymbol().setColor(null));

    var renderer = new esri.renderer.ClassBreaksRenderer(null, statisticGenerator);

    renderer._joinField = joinField;
    renderer._currentYear = startYear;
    renderer._data = data;
    renderer.setMaxInclusive(true);

    addBreaks(renderer);

    return renderer;
  }

  function addRenderer(featureLayer, renderer) {
    var def = new dojo.Deferred();
    
    // wait to start animating until after featurelayer has drawn.
    var handle = dojo.connect(featureLayer, "onUpdateEnd", function () { 
      // data is loaded and drawn, fade out the app's loading icon
      fadeOutLoading();
      dojo.disconnect(handle);
      createLegend(this);
      dojo.style("pause", "display", "inline-block");
      def.resolve();
    });

    featureLayer.setRenderer(renderer);
    featureLayer.show();

    return def;
  }

  function changeYear() {
    if (current === end + 1) {
      current = start;
    }
    updateRenderer(current, featureLayer);
    dojo.byId("currentYear").innerHTML = current++;
  };

  function createLegend(layer) {
    var legendDijit = new esri.dijit.Legend({
      map: map,
      layerInfos: [{
        "layer": layer,
        "title": "GDP增速变化"
      }]
    }, "legend");
    legendDijit.startup();
    dojo.style("feedback", "visibility", "visible");
  }

  function calculateChange(Pt2, Pt1, t2_t1) {
    // var rate = ((Math.log(Pt2) - Math.log(Pt1)) / (t2_t1)) * 100;
    // var rate = (Pt2 - Pt1) / (t2_t1) * 100;
    var rate = dojo.number.round(((Pt2 - Pt1) / Pt2 * 100), 2);
    // console.log("rate is: ", rate);
    return rate;
  }

  function addBreaks(renderer) {
    var currentYear = renderer._currentYear,
      data = renderer._data,
      totalGrowth = calculateChange(data['110100'][currentYear], data['110100'][currentYear - 1], 1),
      roundedTotalGrowth = dojo.number.round(totalGrowth, 2);

    renderer.clearBreaks();

    var negative = [253, 174, 97];
    // var flat = [166, 217, 106];
    var flat = [225, 236, 231];
    var positive = [26, 150, 65];
    var white = [255, 255, 255];

    renderer.addBreak({
      minValue: -Infinity,
      maxValue: 0,
      symbol: new esri.symbol.SimpleFillSymbol().setColor(new dojo.Color(negative))
        .setOutline(new esri.symbol.SimpleLineSymbol().setColor(new dojo.Color(white))),
      label: "减少"
    });

    renderer.addBreak({
      minValue: 0,
      maxValue: roundedTotalGrowth,
      symbol: new esri.symbol.SimpleFillSymbol().setColor(new dojo.Color(flat))
        .setOutline(new esri.symbol.SimpleLineSymbol().setColor(new dojo.Color(white))),
      label: "持平"
    });

    renderer.addBreak({
      minValue: roundedTotalGrowth,
      maxValue: Infinity,
      symbol: new esri.symbol.SimpleFillSymbol().setColor(new dojo.Color(positive))
        .setOutline(new esri.symbol.SimpleLineSymbol().setColor(new dojo.Color(white))),
      label: "增加"
    });
  }

  function updateRenderer(year, featureLayer) {
    featureLayer.renderer._currentYear = year;
    addBreaks(featureLayer.renderer);
    featureLayer.redraw();
    var sel = map.infoWindow.getSelectedFeature();
    if ( sel && map.infoWindow.isShowing ) {
      map.infoWindow.setFeatures([ sel ]);
    }
  }

  function animPause() {
    clearTimeout(anim);
    disableButton(dojo.byId("faster"));
    disableButton(dojo.byId("slower"));
  }

  function animPlay() {
    anim = setInterval(changeYear, interval);
    enableButton(dojo.byId("faster"));
    enableButton(dojo.byId("slower"));
  }
  
  function animFast() {
    clearTimeout(anim);
    interval = (interval > 250) ? interval / 2 : interval;
    if (interval === 250) {
      disableButton(dojo.byId("faster"));
    } else if (interval === 2000) {
      enableButton(dojo.byId("slower"));
    };
    anim = setInterval(changeYear, interval);
  }
  
  function animSlow() {
    clearTimeout(anim);
    interval = (interval < 4000) ? interval * 2 : interval;
    if (interval === 4000) {
      disableButton(dojo.byId("slower"));
    } else if (interval === 500){
      enableButton(dojo.byId("faster"));
    };
    anim = setInterval(changeYear, interval);
  }

  function fadeOutLoading() {
    var fade = dojo.fadeOut({ "node": "loading" });
    var fadeAnim = dojo.connect(fade, "onEnd", function() { 
      dojo.destroy(dojo.byId("loading")); 
      dojo.disconnect(fadeAnim);
    });
    fade.play();
  }
  
  function disableButton(dom) {
    dojo.style(dom, "opacity", 0.3);
    dojo.style(dom, "cursor", "auto");
  }
  
  function enableButton(dom) {
    dojo.style(dom, "opacity", 1.0);
    dojo.style(dom, "cursor", "pointer");
  }

  dojo.ready(init);