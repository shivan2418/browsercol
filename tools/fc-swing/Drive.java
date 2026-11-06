import java.awt.*; import java.awt.event.*; import java.awt.image.*; import javax.imageio.*; import java.io.*;
/** Drives the screen: each arg is one step. wait:MS  shot:NAME  click:X,Y  rclick:X,Y  key:NAME (a KeyEvent VK_ name, + joins modifiers, e.g. key:CONTROL+S)  type:TEXT */
public class Drive { public static void main(String[] a) throws Exception {
  Robot r = new Robot(); r.setAutoDelay(40);
  for (String s : a) { int c = s.indexOf(':'); String op = s.substring(0, c), v = s.substring(c + 1);
    switch (op) {
      case "wait" -> Thread.sleep(Long.parseLong(v));
      case "shot" -> { Dimension d = Toolkit.getDefaultToolkit().getScreenSize();
        ImageIO.write(r.createScreenCapture(new Rectangle(d)), "png", new File("/w/shots/" + v + ".png")); System.out.println("shot " + v); }
      case "click", "rclick" -> { String[] p = v.split(","); r.mouseMove(Integer.parseInt(p[0]), Integer.parseInt(p[1]));
        int b = op.equals("click") ? InputEvent.BUTTON1_DOWN_MASK : InputEvent.BUTTON3_DOWN_MASK; r.mousePress(b); r.mouseRelease(b); }
      case "key" -> { String[] k = v.split("\\+"); int[] codes = new int[k.length];
        for (int i = 0; i < k.length; i++) codes[i] = KeyEvent.class.getField("VK_" + k[i].toUpperCase()).getInt(null);
        for (int x : codes) r.keyPress(x); for (int i = codes.length - 1; i >= 0; i--) r.keyRelease(codes[i]); }
      case "type" -> { for (char ch : v.toCharArray()) { int x = KeyEvent.getExtendedKeyCodeForChar(ch); boolean up = Character.isUpperCase(ch);
        if (up) r.keyPress(KeyEvent.VK_SHIFT); r.keyPress(x); r.keyRelease(x); if (up) r.keyRelease(KeyEvent.VK_SHIFT); } }
      default -> throw new IllegalArgumentException(s);
    } } } }
