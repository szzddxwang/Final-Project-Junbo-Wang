package myfirstmodule.integration;
import java.nio.file.Path;
/** Local dependency paths for the redistributable installation. */
public final class BackendPaths {
 private BackendPaths() {}
 public static Path config(String name) {
  if (!name.matches("[A-Za-z0-9_.-]+")) throw new IllegalArgumentException("Invalid local configuration file");
  String root = System.getenv("MICROEXPLORE_BACKEND_ROOT");
  Path base = root == null || root.isBlank() ? Path.of("backend").toAbsolutePath() : Path.of(root).toAbsolutePath();
  return base.resolve("config").resolve(name);
 }
}
