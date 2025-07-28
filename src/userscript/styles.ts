import styles from "inline:./styles.css";

const STYLE_SHEET_NAME = "arueshalae_styles";
const style = document.createElement("style");
style.id = STYLE_SHEET_NAME;
style.innerHTML = styles;
document.head.appendChild(style);
