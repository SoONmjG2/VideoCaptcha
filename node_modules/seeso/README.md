
# SeeSo SDK Web - NPM Module 

## **Supported Environment**

- Browser Support

| ![chrome](https://docs.seeso.io/img/web-quick-start/chrome.png) | ![firefox](https://docs.seeso.io/img/web-quick-start/firefox.png) | ![edge](https://docs.seeso.io/img/web-quick-start/edge.png) | ![safari](https://docs.seeso.io/img/web-quick-start/safari.png) |
| ------ | ------ | ---     | ---   | 
| 80+ ✔︎ |ﾠLatest ✔︎︎ |  ﾠLatest ✔︎︎ | 15.2 - 18.1 |

## **Environment Set-ups**
* Download SDK files directly. The Following files should exist:
    1. Go to the path where you downloaded the SDK files.
       There should be the following files below.
        - SeeSo
            - dist
                - seeso.js
            - easy-seeso.js

* Using npm:
```shell script
$ npm install seeso
```

* Using CDN: It will be available soon.
```html
<script src="https://cdn.seeso.io/seeso.js"></script>
```

### Issue License key (Required)
Get a license key from the <a target="_blank" href="https://console.seeso.io"> SeeSo Console </a>


### SIMD Setting (Chrome Optional)

    * Using this setting improves the performance of the SDK.
    * If SIMD option is off, high fps setting (ex: `30`) may drop CPU performance.  

1. in `chrome://flags/`
2. WebAssembly SIMD support set Enabled
![SIMD setting](https://docs.seeso.io/img/web-quick-start/simd-chrome-setting.png)
   
## **Sample App Implemetation**

### Import SDK module and Check SDK status

- If "afterInitialized" function is called, it means SDK is ready to use.
    ```Javascript
  // when SDK files download
  import EasySeeSo from './seeso/easy-seeso.js'  

  // when npm or cdn import
  import EasySeeSo from 'seeso/easy-seeso';

  (async () => {
      const seeso = new EasySeeSo();
      // Don't forget to enter your license key.
      await seeso.init('YOUR_LICENSE_KEY', afterInitialized, afterFailed)
  })()

  function afterInitialized () {
      console.log('sdk init success!')
  }

  function afterFailed () {
      console.log('sdk init fail!')
  }
    ```
    
 ### Call Calibration Page 
 
```Javascript
    ...
    
    function callCalibrationPage() {
        // static function. 
        // Because the web page is moved. (https://calibration.seeso.io/#/service)
        EasySeeSo.openCalibrationPage('YOUR_LICENSE_KEY', 'YOUR_USER_ID', 'YOUR_REDIRECT_URL', 5); // 5 is number of calibration points
    }
    
```
 ### Set Calibration Data

```Javascript

    ...

    // in redirected page
    function parseCalibrationDataInQueryString () {
      const href = window.location.href
      const decodedURI = decodeURI(href)
      const queryString = decodedURI.split('?')[1];

      if (!queryString) return undefined
      const jsonString = queryString.slice("calibrationData=".length, queryString.length)
      return jsonString
    }
    
    function setCalibrationDataOnSeeSoSDK() {
        const calibrationData = parseCalibrationDataInQueryString();
        seeso.setCalibrationData(calibrationData)
    }
    
```


###  Show Gaze Point
```Javascript

    import { TrackingState } from 'seeso';
    ... 

    //GazeCallback implementation
    function onGaze (gazeInfo) {
        if (gazeInfo.trackingState === TrackingState.SUCCESS){
            let canvas = document.getElementById("output")
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
            let ctx = canvas.getContext("2d");
            ctx.fillStyle = '#FF0000'
            ctx.clearRect(0, 0, canvas.width, canvas.height )
            ctx.beginPath();
            ctx.arc(gazeInfo.x, gazeInfo.y, 10, 0, Math.PI * 2, true);
            ctx.fill();
        }
    }
    
```


## **Sample Project**

Here is a sample [VanillaJS Demo](https://github.com/visualcamp/SeeSoSample-Web)

## Caution when deploying : Enable Cross-Origin Isolation
> * The content of this part is not necessary for `development`.
    However, it is required for `deployment`.
    seeso.js uses [SharedArrayBuffer Object](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

Cross-Origin Isolation must be enabled to use SharedArrayBuffer in some browsers.

* Chrome: Optional, Soon Required after v91
  > See [Chromium blog][chromiumblog]
* Firefox, Edge: Required.
  > Some web APIs increase the risk of side-channel attacks like Spectre. To mitigate that risk, browsers offer an opt-in-based isolated environment called cross-origin isolated. With a cross-origin isolated state, the webpage will be able to use privileged features including SharedArrayBuffer

* For cross-origin-isolation, please refer to the documents below.
    * [A guide to enable cross-origin isolation](https://web.dev/cross-origin-isolation-guide/)
    * [Why you need “cross-origin isolated” for powerful features](https://web.dev/why-coop-coep/)
    * [Making your website “cross-origin isolated” using COOP and COEP](https://web.dev/coop-coep/)
    * [SharedArrayBuffer - JavaScript | MDN](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)

[chromiumblog]: https://blog.chromium.org/2021/02/restriction-on-sharedarraybuffers.html "Go chromium blog"
