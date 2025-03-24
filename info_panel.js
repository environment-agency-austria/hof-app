import { feature_id_property, popupAttributes } from "./config";
import QRCode from 'qrcode';

export async function renderFeatureInfoPanel(feature) {

    let attrRows = "";
    for (let attr of popupAttributes) {
      let attrValue = feature.get(attr.attrid);
  
      if (attrValue !== undefined && attrValue !== null) {
        attrValue = attrValue.toString();
  
        let renderedValue;
        if (attrValue && attrValue.startsWith("http://") || attrValue.startsWith("https://")) {
          renderedValue = `<a target="_blank" href="${attrValue}">${attrValue}</a></td></tr>`;
        } else {
          renderedValue = attrValue;
        }
  
        attrRows += `<tr><td>${attr.label}</td><td>${renderedValue}</td></tr>`;
      }
    }
  
    const gmlId = feature.get(feature_id_property);
    if (gmlId) {
      const codeImg = await QRCode.toDataURL(gmlId);
      attrRows += `
                <tr><td>Auflösbarer Identifier</td><td><a target="_blank" href="${gmlId}">${gmlId}</a></td></tr>
                <tr><td>QR-Code</td><td style="text-align: center;"><img src="${codeImg}"/></td></tr>`;
    }
    return attrRows;
  }