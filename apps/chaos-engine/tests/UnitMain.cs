// Point d'entrée de chaos-unit.exe (tests de la logique pure, compilés avec src\Model et src\Interop\Json.cs).
namespace Raptoru.Chaos
{
    static class UnitMain
    {
        static int Main() { return UnitTests.Run(); }
    }
}
