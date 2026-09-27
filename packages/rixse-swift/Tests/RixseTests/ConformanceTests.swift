// The swift-testing suite over the shared conformance vectors. All checks live
// in RixseConformance and are shared with the `rixse-conformance-check`
// executable, so `swift test` and the executable gate can never disagree.
import Testing
import RixseConformance

@Suite struct ConformanceTests {
  @Test func validateVectors() throws { _ = try checkValidate() }
  @Test func placeVectors() throws { _ = try checkPlace() }
  @Test func defineComponentVectors() throws { _ = try checkDefineComponent() }
  @Test func createViewportVectors() throws { _ = try checkCreateViewport() }
  @Test func viewportScenarios() throws { _ = try checkViewportScenarios() }
  @Test func layoutVectors() throws { _ = try checkLayout() }
  @Test func catalogueAndVocabulary() throws { _ = try checkCatalogueAndVocabulary() }
  @Test func moviesCatalogueAndVocabulary() throws { _ = try checkMoviesCatalogueAndVocabulary() }
  @Test func wireVectors() throws { _ = try checkWire() }
  @Test func moviesWireVectors() throws { _ = try checkMoviesWire() }
}
